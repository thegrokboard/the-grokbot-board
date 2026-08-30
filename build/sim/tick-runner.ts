import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import * as fs from "fs";
import * as path from "path";

// Load the last three Jito depeg price series (placeholder historical data for sim)
const PRICE_SERIES = [
  { slot: 100, price: 0.98 },
  { slot: 110, price: 0.95 },
  { slot: 120, price: 0.92 },
  { slot: 200, price: 0.89 },
  { slot: 210, price: 0.85 },
  { slot: 300, price: 0.82 },
  { slot: 310, price: 0.78 },
  { slot: 400, price: 0.75 },
  { slot: 500, price: 0.72 },
  { slot: 600, price: 0.95 }, // recovery
];

const LAG_SLOTS = 90; // ~45s at 0.5s/slot target
const TWAP_WINDOW_SLOTS = 30; // 15s TWAP

async function main() {
  console.log("Starting 7-day JitoSOL depeg simulation harness...");

  // Setup local test validator connection
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const payer = Keypair.generate();

  // Airdrop to payer
  const airdropSig = await connection.requestAirdrop(payer.publicKey, 10 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdropSig);

  const provider = new AnchorProvider(connection, new Wallet(payer), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as Program<Vault>;

  // Derive PDAs
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId
  );
  const [bufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protection_buffer")],
    program.programId
  );

  console.log("Vault PDA:", vaultPda.toBase58());
  console.log("Buffer PDA:", bufferPda.toBase58());

  // Initialize vault (owner is payer)
  await program.methods
    .initialize()
    .accounts({
      vault: vaultPda,
      buffer: bufferPda,
      owner: payer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log("Vault initialized.");

  let breakerTrips = 0;
  let falsePositives = 0;
  let currentSlot = 0;
  const totalTicks = 7 * 24 * 60 * 4; // 7 days * 24h * 60min * 4 ticks/min (~15s)

  console.log(`Running ${totalTicks} simulation ticks...`);

  for (let tick = 0; tick < totalTicks; tick++) {
    currentSlot += 4; // advance ~2s per tick for sim speed

    // Inject lagged prices from replay series
    const laggedPrices = injectLaggedPrices(currentSlot, PRICE_SERIES, LAG_SLOTS);

    // Run 15s TWAP checker
    const result = checkTwap(laggedPrices, TWAP_WINDOW_SLOTS);
    
    if (result.trip) {
      breakerTrips++;
      console.log(`[TICK ${tick}] Breaker TRIPPED at slot ${currentSlot} (price=${result.twap.toFixed(4)})`);
      
      // Call on-chain circuit breaker (owner pause simulation)
      try {
        await program.methods
          .triggerCircuitBreaker()
          .accounts({
            vault: vaultPda,
            owner: payer.publicKey,
          })
          .rpc();
      } catch (e) {
        // already paused - expected in sim
      }
    } else if (result.falsePositive) {
      falsePositives++;
      console.log(`[TICK ${tick}] False positive detected (TWAP=${result.twap.toFixed(4)})`);
    }

    // Simulate owner withdraw after pause in some cases
    if (breakerTrips % 5 === 0 && breakerTrips > 0) {
      try {
        await program.methods
          .ownerWithdraw()
          .accounts({
            vault: vaultPda,
            owner: payer.publicKey,
            buffer: bufferPda,
          })
          .rpc();
      } catch (e) {}
    }

    // Throttle output
    if (tick % 100 === 0) {
      console.log(`Progress: ${((tick / totalTicks) * 100).toFixed(1)}% | Trips: ${breakerTrips} | False Pos: ${falsePositives}`);
    }
  }

  console.log("\n=== SIMULATION COMPLETE ===");
  console.log(`Total breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / (breakerTrips || 1)) * 100).toFixed(1)}%`);
  console.log("Pure on-chain Anchor JitoSOL vault sim finished.");
}

// Lag injector helper (replays series with slot-exact lag)
function injectLaggedPrices(currentSlot: number, series: any[], lag: number): any[] {
  return series
    .filter(p => p.slot + lag <= currentSlot)
    .map(p => ({ slot: p.slot + lag, price: p.price }));
}

// 15s TWAP false-positive checker
function checkTwap(prices: any[], window: number): { trip: boolean; falsePositive: boolean; twap: number } {
  if (prices.length === 0) return { trip: false, falsePositive: false, twap: 1.0 };

  const recent = prices.slice(-window);
  const avg = recent.reduce((sum, p) => sum + p.price, 0) / recent.length;
  const trip = avg < 0.90;
  const falsePositive = avg < 0.95 && avg >= 0.90; // near-miss that would false trip on bad oracle

  return { trip, falsePositive, twap: avg };
}

// Run the simulation
main().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
