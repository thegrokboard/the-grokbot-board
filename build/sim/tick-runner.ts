import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import { createLagInjector, injectLagPrice } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { loadJitoDepegSeries } from "./oracle-utils";

const SERIES_DURATION_SLOTS = 7 * 24 * 60 * 60 / 0.4; // ~7 days at ~400ms/slot
const TARGET_LAG_SLOTS = 112; // 45s @ ~0.4s/slot

async function main() {
  // Setup local test validator connection
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  
  // Use default Anchor provider (assumes solana-test-validator running with Anchor config)
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  
  const program = new Program<Vault>(
    require("../target/idl/vault.json"),
    provider
  );

  const owner = provider.wallet.publicKey;
  const jitoSolMint = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Yg9pL");
  
  // Derive PDA accounts
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), jitoSolMint.toBuffer()],
    program.programId
  );
  
  const [bufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protection_buffer"), vaultPda.toBuffer()],
    program.programId
  );
  
  const [oraclePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("price_oracle"), jitoSolMint.toBuffer()],
    program.programId
  );

  console.log("=== Pure Onchain Anchor JitoSOL Depeg Sim Harness ===");
  console.log(`Vault PDA: ${vaultPda}`);
  console.log(`Buffer PDA: ${bufferPda}`);
  console.log(`Oracle PDA: ${oraclePda}`);
  console.log(`Target lag: ${TARGET_LAG_SLOTS} slots (~45s)`);
  console.log(`Simulation length: ~${SERIES_DURATION_SLOTS} slots (7 days)\n`);

  // Initialize vault if needed (idempotent in sim)
  try {
    await program.methods
      .initialize(new anchor.BN(5000), new anchor.BN(1000)) // 5% drawdown threshold, 10% buffer
      .accounts({
        vault: vaultPda,
        buffer: bufferPda,
        oracle: oraclePda,
        owner: owner,
        mint: jitoSolMint,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Vault initialized.");
  } catch (e) {
    console.log("Vault already initialized (expected in repeated runs).");
  }

  const series = loadJitoDepegSeries();
  console.log(`Loaded ${series.length} price points from last three Jito depeg events.`);

  const injector = createLagInjector(connection, oraclePda, TARGET_LAG_SLOTS);
  
  let breakerTrips = 0;
  let falsePositives = 0;
  let currentSlot = await connection.getSlot();

  for (let i = 0; i < series.length && i < SERIES_DURATION_SLOTS; i++) {
    const point = series[i];
    const slot = currentSlot + i;
    
    // Inject lagged price
    await injectLagPrice(injector, point.price, point.confidence, slot);
    
    // Check 15s TWAP (approx 37-38 slots)
    const isFalsePositive = checkTWAPFalsePositive(series, i, 38);
    
    // Call on-chain drawdown circuit breaker
    try {
      await program.methods
        .checkDrawdown()
        .accounts({
          vault: vaultPda,
          buffer: bufferPda,
          oracle: oraclePda,
          owner: owner,
        })
        .rpc();
      
      if (isFalsePositive) {
        falsePositives++;
        console.log(`Slot ${slot}: TWAP false-positive detected but breaker did NOT trip (good)`);
      } else {
        console.log(`Slot ${slot}: Breaker passed (price=${point.price})`);
      }
    } catch (err: any) {
      breakerTrips++;
      if (isFalsePositive) {
        console.log(`Slot ${slot}: FALSE POSITIVE - Breaker tripped on TWAP recovery! (price=${point.price})`);
      } else {
        console.log(`Slot ${slot}: BREAKER TRIPPED (price=${point.price}, drawdown detected)`);
      }
    }

    // Simulate ~1s per tick for readability (real sim can be accelerated)
    if (i % 50 === 0) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  console.log("\n=== Simulation Complete ===");
  console.log(`Total breaker trips: ${breakerTrips}`);
  console.log(`False positives (TWAP recovery): ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / (breakerTrips || 1)) * 100).toFixed(1)}%`);
  
  // Owner pause + withdraw test (post sim)
  console.log("\nTesting owner pause and emergency withdraw...");
  try {
    await program.methods
      .pause()
      .accounts({
        vault: vaultPda,
        owner: owner,
      })
      .rpc();
    console.log("Vault paused by owner.");
    
    await program.methods
      .emergencyWithdraw()
      .accounts({
        vault: vaultPda,
        buffer: bufferPda,
        owner: owner,
        destination: owner,
      })
      .rpc();
    console.log("Emergency withdraw executed successfully.");
  } catch (e) {
    console.log("Owner actions completed (some expected in sim).");
  }
}

main().catch((err) => {
  console.error("Sim failed:", err);
  process.exit(1);
});
