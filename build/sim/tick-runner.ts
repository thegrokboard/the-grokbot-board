import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import { createLagInjector, injectLagPrice } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { readFileSync } from "fs";
import { join } from "path";

// ------------------------------------------------------------------
// Configuration
// ------------------------------------------------------------------
const LAG_SLOTS = 90;                    // ~45s at 500ms/slot
const TICK_INTERVAL_MS = 15000;          // 15s TWAP windows
const SIM_DAYS = 7;
const SLOTS_PER_DAY = 24 * 60 * 60 * 2;  // 2 slots per second
const TOTAL_SLOTS = SIM_DAYS * SLOTS_PER_DAY;

const JITO_PRICE_FEED = new PublicKey("J1toreD8z4c4oJ2z6v4z8vKkL9vL2z3x4y5z6x7v8w9"); // placeholder for sim oracle
const VAULT_PROGRAM_ID = new PublicKey("Vau1t1111111111111111111111111111111111111");

const PRICE_SERIES_PATH = join(__dirname, "jito-depeg-series.json");

// ------------------------------------------------------------------
// On-chain Vault + Buffer Accounts
// ------------------------------------------------------------------
let vault: PublicKey;
let protectionBuffer: PublicKey;
let owner: Keypair;

// ------------------------------------------------------------------
// Simulation State
// ------------------------------------------------------------------
let currentSlot = 0;
let breakerTrips = 0;
let falsePositives = 0;
let lastPrice = 1.0;
let priceHistory: number[] = [];

// ------------------------------------------------------------------
// Helper: load replay series (price + slot timestamps)
// ------------------------------------------------------------------
function loadPriceSeries(): Array<{ slot: number; price: number }> {
  const raw = readFileSync(PRICE_SERIES_PATH, "utf-8");
  return JSON.parse(raw) as Array<{ slot: number; price: number }>;
}

// ------------------------------------------------------------------
// On-chain helper: initialize vault (once)
// ------------------------------------------------------------------
async function initializeVault(provider: AnchorProvider, program: Program<Vault>) {
  owner = Keypair.generate();
  const vaultKp = Keypair.generate();
  vault = vaultKp.publicKey;

  const bufferKp = Keypair.generate();
  protectionBuffer = bufferKp.publicKey;

  const tx = await program.methods
    .initialize(0) // 0% fee for sim
    .accounts({
      vault: vault,
      owner: owner.publicKey,
      protectionBuffer: protectionBuffer,
      systemProgram: SystemProgram.programId,
    })
    .signers([vaultKp, bufferKp, owner])
    .rpc();

  console.log(`Vault initialized at ${vault.toBase58()} (slot ${currentSlot})`);
}

// ------------------------------------------------------------------
// On-chain helper: call drawdown circuit breaker
// ------------------------------------------------------------------
async function triggerCircuitBreaker(program: Program<Vault>, price: number) {
  try {
    const tx = await program.methods
      .triggerDrawdown(new anchor.BN(Math.floor(price * 1e9))) // price in 9 decimals
      .accounts({
        vault: vault,
        owner: owner.publicKey,
        oracle: JITO_PRICE_FEED,
        protectionBuffer: protectionBuffer,
      })
      .signers([owner])
      .rpc();

    console.log(`[BREAKER TRIP] slot=${currentSlot} price=${price.toFixed(4)} tx=${tx}`);
    breakerTrips++;
    return true;
  } catch (err: any) {
    console.error(`[BREAKER FAILED] ${err.message}`);
    return false;
  }
}

// ------------------------------------------------------------------
// Main simulation loop
// ------------------------------------------------------------------
async function runSimulation() {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = new Program<Vault>(
    JSON.parse(readFileSync("./target/idl/vault.json", "utf-8")),
    VAULT_PROGRAM_ID,
    provider
  );

  await initializeVault(provider, program);

  const injector = createLagInjector(connection, JITO_PRICE_FEED, LAG_SLOTS);
  const series = loadPriceSeries();

  console.log(`Starting 7-day JitoSOL depeg sim (${series.length} ticks, lag=${LAG_SLOTS} slots)...\n`);

  let seriesIdx = 0;
  let lastTickSlot = 0;

  while (currentSlot < TOTAL_SLOTS) {
    // Advance to next tick
    currentSlot = Math.min(currentSlot + Math.floor(TICK_INTERVAL_MS / 500), TOTAL_SLOTS);

    // Inject lagged price from replay series
    while (seriesIdx < series.length && series[seriesIdx].slot <= currentSlot - LAG_SLOTS) {
      const entry = series[seriesIdx];
      await injectLagPrice(injector, entry.price, entry.slot);
      lastPrice = entry.price;
      priceHistory.push(entry.price);
      seriesIdx++;
    }

    // Run 15s TWAP false-positive checker
    if (priceHistory.length >= 3) {
      const isFalsePositive = checkTWAPFalsePositive(priceHistory, 0.05); // 5% drawdown threshold
      if (isFalsePositive) {
        falsePositives++;
        console.log(`[FALSE POSITIVE] slot=${currentSlot} price=${lastPrice.toFixed(4)}`);
      } else if (lastPrice < 0.97) { // real drawdown detected
        const tripped = await triggerCircuitBreaker(program, lastPrice);
        if (tripped) {
          // pause vault after trip
          await program.methods
            .pause()
            .accounts({ vault, owner: owner.publicKey })
            .signers([owner])
            .rpc();
          console.log(`[VAULT PAUSED] at slot ${currentSlot}`);
          break; // end sim on first real trip for this harness
        }
      }
    }

    // Throttle output
    if (currentSlot - lastTickSlot >= 480) { // ~4min log cadence
      console.log(`tick slot=${currentSlot} price=${lastPrice.toFixed(4)} trips=${breakerTrips} fp=${falsePositives}`);
      lastTickSlot = currentSlot;
    }

    // Simulate passage of time
    await new Promise((r) => setTimeout(r, 50)); // fast-forward sim
  }

  // Final stats
  console.log("\n=== SIMULATION COMPLETE ===");
  console.log(`Total slots simulated : ${currentSlot}`);
  console.log(`Breaker trips          : ${breakerTrips}`);
  console.log(`False positives        : ${falsePositives}`);
  console.log(`Final Jito price       : ${lastPrice.toFixed(4)}`);
  console.log(`Outcome                : ${breakerTrips > 0 ? "PROTECTION TRIGGERED" : "NO BREACH"}`);
}

// ------------------------------------------------------------------
// Run
// ------------------------------------------------------------------
runSimulation().catch((err) => {
  console.error("Simulation crashed:", err);
  process.exit(1);
});
