import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createLagInjector, injectLagPrice } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createPriceAccount, updatePriceAccount, PriceData } from "./oracle-utils";

const CLUSTER_URL = "http://127.0.0.1:8899";
const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn");
const ORACLE_PROGRAM_ID = new PublicKey("7r8vPq3t8vPq3t8vPq3t8vPq3t8vPq3t8vPq3t8vPq3"); // placeholder for sim
const PYTH_ORACLE_FEED = new PublicKey("H6ARHf6YXhGYeQfUzQNGk6qGfC5zH4u4m3g9zQf5z4z");

async function main() {
  const connection = new Connection(CLUSTER_URL, "confirmed");
  const wallet = Keypair.generate();
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {});
  anchor.setProvider(provider);

  // Setup price account
  const priceAccount = await createPriceAccount(connection, wallet, PYTH_ORACLE_FEED);

  // Create lag injector
  const injector = createLagInjector(connection, wallet, priceAccount, 45);

  // Replay series (last three Jito depeg points - simplified for sim)
  const priceSeries: PriceData[] = [
    { price: 0.92, confidence: 0.01, timestamp: Date.now() / 1000 - 90 },
    { price: 0.85, confidence: 0.02, timestamp: Date.now() / 1000 - 60 },
    { price: 0.78, confidence: 0.015, timestamp: Date.now() / 1000 - 30 },
  ];

  console.log("Starting pure-onchain Anchor JitoSOL depeg sim...");

  let breakerTrips = 0;
  let falsePositives = 0;
  const TICK_INTERVAL_MS = 15000; // 15s TWAP check

  // 7-day sim runner (simulated with 20 ticks for test harness)
  for (let tick = 0; tick < 20; tick++) {
    const currentTime = Date.now();
    const lagPrice = injectLagPrice(injector, priceSeries, currentTime);

    // Update on-chain oracle with lagged price
    await updatePriceAccount(connection, wallet, priceAccount, lagPrice.price, lagPrice.confidence);

    // Run 15s TWAP false-positive checker - exactly 3 args per twap-checker.ts
    const isFalsePositive = checkTWAPFalsePositive(
      priceSeries,
      lagPrice,
      TICK_INTERVAL_MS
    );

    if (isFalsePositive) {
      falsePositives++;
      console.log(`Tick ${tick}: TWAP false positive detected (price=${lagPrice.price})`);
    } else if (lagPrice.price < 0.80) {
      breakerTrips++;
      console.log(`Tick ${tick}: DRAW DOWN CIRCUIT BREAKER TRIPPED (price=${lagPrice.price})`);
    } else {
      console.log(`Tick ${tick}: normal operation (price=${lagPrice.price.toFixed(3)})`);
    }

    // Simulate time passage
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log("\n=== SIMULATION COMPLETE ===");
  console.log(`Breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log("Pure-onchain Anchor vault sim harness finished.");
}

main().catch(err => {
  console.error("Sim failed:", err);
  process.exit(1);
});
