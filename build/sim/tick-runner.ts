import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createLagInjector, injectLagPrice } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createPriceAccount, updatePriceAccount, PriceData } from "./oracle-utils";

const RPC_URL = "http://127.0.0.1:8899";
const ORACLE_PROGRAM_ID = new PublicKey("11111111111111111111111111111111"); // placeholder for sim
const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6YgP7rL");

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(Keypair.generate()); // funded in test validator
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const lagInjector = createLagInjector(provider, ORACLE_PROGRAM_ID);
  const priceAccount = await createPriceAccount(provider, ORACLE_PROGRAM_ID, JITO_SOL_MINT);

  // Replay last three known Jito depeg series (simplified sample data)
  const priceSeries: PriceData[] = [
    { price: 0.92, confidence: 0.01, timestamp: Date.now() / 1000 - 180, slot: 100 },
    { price: 0.85, confidence: 0.02, timestamp: Date.now() / 1000 - 120, slot: 200 },
    { price: 0.78, confidence: 0.03, timestamp: Date.now() / 1000 - 60, slot: 300 },
    { price: 0.95, confidence: 0.01, timestamp: Date.now() / 1000, slot: 400 },
  ];

  console.log("Starting 7-day tick sim with 45s oracle lag...");

  let breakerTrips = 0;
  let falsePositives = 0;
  const TICK_INTERVAL_MS = 15000; // 15s TWAP window check
  const TOTAL_TICKS = 7 * 24 * 60 * 4; // ~7 days at 15s ticks

  for (let tick = 0; tick < TOTAL_TICKS; tick++) {
    const currentSlot = 1000 + tick * 4; // slot progression
    const currentTime = Date.now() / 1000 + tick * 15;

    // Inject lagged price
    const laggedIndex = Math.max(0, priceSeries.length - 3 + Math.floor(tick / 10) % 3);
    const laggedPrice = priceSeries[laggedIndex % priceSeries.length];
    await injectLagPrice(lagInjector, priceAccount, laggedPrice.price, currentSlot);

    // Update oracle with "real" price (for TWAP reference)
    await updatePriceAccount(provider, priceAccount, laggedPrice.price, laggedPrice.confidence, currentTime, currentSlot);

    // Run 15s TWAP false-positive checker
    const isFalsePositive = checkTWAPFalsePositive(priceSeries.slice(-5), 0.10); // 10% drawdown threshold
    if (isFalsePositive) {
      falsePositives++;
      console.log(`Tick ${tick}: False positive TWAP breaker trip`);
    }

    // Simulate drawdown circuit-breaker trip (simple threshold for demo)
    if (laggedPrice.price < 0.80) {
      breakerTrips++;
      console.log(`Tick ${tick}: Real breaker trip at price ${laggedPrice.price}`);
    }

    if (tick % 100 === 0) {
      console.log(`Progress: ${tick}/${TOTAL_TICKS} ticks | Trips: ${breakerTrips} | False+: ${falsePositives}`);
    }

    await new Promise(resolve => setTimeout(resolve, 50)); // fast-forward sim
  }

  console.log("\nSimulation complete.");
  console.log(`Breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log("Pure onchain Anchor vault sim harness finished.");
}

main().catch(console.error);
