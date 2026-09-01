import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createLagInjector, injectLagPrice } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createPriceAccount, updatePriceAccount, PriceData } from "./oracle-utils";
import { Vault } from "../target/types/vault";

async function main() {
  // Setup provider
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const payer = Keypair.generate();
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  // Airdrop
  await connection.requestAirdrop(payer.publicKey, 10 * LAMPORTS_PER_SOL);

  // Load program
  const program = anchor.workspace.Vault as Program<Vault>;

  // Oracle setup
  const oracleKeypair = Keypair.generate();
  const oraclePubkey = await createPriceAccount(provider, oracleKeypair);

  // Initial price ~1.0 (jitoSOL)
  await updatePriceAccount(provider, oraclePubkey, 1_000_000_000, 10_000_000); // price, confidence

  // Lag injector (target 45s lag, replay last 3 depeg series)
  const injector = createLagInjector(oraclePubkey, 45, 3);

  // Protection buffer and vault accounts
  const bufferKeypair = Keypair.generate();
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), payer.publicKey.toBuffer()],
    program.programId
  );

  // Initialize vault (owner = payer)
  await program.methods
    .initialize()
    .accounts({
      vault: vaultPda,
      owner: payer.publicKey,
      buffer: bufferKeypair.publicKey,
      oracle: oraclePubkey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([bufferKeypair])
    .rpc();

  // 7-day sim at ~15s ticks (but we drive manually here)
  const TICKS = 7 * 24 * 60 * 4; // ~15s intervals
  let breakerTrips = 0;
  let falsePositives = 0;
  let currentSlot = 0;

  console.log("Starting 7-day onchain JitoSOL depeg sim...");

  for (let i = 0; i < TICKS; i++) {
    currentSlot += 4; // ~15s per tick at 0.4s/slot

    // Inject lagged price from replay series
    const priceData: PriceData = await injectLagPrice(provider, injector, currentSlot);

    // Update on-chain oracle
    await updatePriceAccount(
      provider,
      oraclePubkey,
      priceData.price,
      priceData.confidence
    );

    // Run drawdown circuit-breaker check via program (logs trip)
    try {
      await program.methods
        .checkDrawdown()
        .accounts({
          vault: vaultPda,
          oracle: oraclePubkey,
          buffer: bufferKeypair.publicKey,
        })
        .rpc();
    } catch (e) {
      // breaker tripped
      breakerTrips++;
      console.log(`Breaker tripped at tick ${i} (slot ~${currentSlot})`);
    }

    // Off-chain 15s TWAP false-positive checker (uses last 3 prices)
    const isFalsePositive = checkTWAPFalsePositive(
      priceData,
      0.05, // 5% drawdown threshold
      15    // 15s window
    );

    if (isFalsePositive) {
      falsePositives++;
      console.log(`False positive TWAP at tick ${i}`);
    }

    // Occasional owner pause/withdraw test
    if (i % 100 === 0 && i > 0) {
      try {
        await program.methods
          .pauseAndWithdraw()
          .accounts({
            vault: vaultPda,
            owner: payer.publicKey,
            buffer: bufferKeypair.publicKey,
          })
          .rpc();
      } catch (_) {}
    }

    // Sleep to simulate real-time
    await new Promise((r) => setTimeout(r, 50));
  }

  console.log("\n=== Simulation Complete ===");
  console.log(`Breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / (breakerTrips || 1)) * 100).toFixed(1)}%`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
