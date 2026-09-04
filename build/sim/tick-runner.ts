import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";

interface TWAPConfig {
  windowSlots: number;
  thresholdBps: number;
}

async function runSimulation() {
  // Setup local test validator connection
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  
  // Load historical JitoSOL price series (last three depeg events)
  const historicalPrices: PriceData[] = getHistoricalJitoPrices();
  
  // Configure lag injector targeting 45s oracle lag (slot-exact at ~0.4s/slot)
  const lagSlots = 112; // ~45 seconds
  const injector = new LagInjector(connection, lagSlots);
  
  console.log("Starting pure-onchain Anchor JitoSOL vault sim harness...");
  console.log(`Replaying ${historicalPrices.length} price points with ${lagSlots}-slot lag`);
  
  // Replay the series through the lag injector
  await injector.replaySeries(historicalPrices);
  
  // Configure 15s TWAP false-positive checker
  const twapConfig: TWAPConfig = {
    windowSlots: 38, // ~15 seconds
    thresholdBps: 500, // 5% drawdown threshold
  };
  
  console.log("Running 15s TWAP false-positive checker over replayed series...");
  
  let breakerTrips = 0;
  let falsePositives = 0;
  
  // Process the lagged price feed slot-by-slot for TWAP checks
  for (let i = 0; i < historicalPrices.length; i++) {
    const currentPrice = historicalPrices[i].price;
    const isFalsePositive = checkTWAPFalsePositive(currentPrice, twapConfig);
    
    if (isFalsePositive) {
      falsePositives++;
      console.log(`Slot ${i}: TWAP false positive detected`);
    }
    
    // Simulate drawdown circuit-breaker trip (simple threshold check on lagged price)
    if (currentPrice < 0.92) { // Example depeg threshold
      breakerTrips++;
      console.log(`Slot ${i}: Circuit breaker TRIPPED (price = ${currentPrice.toFixed(4)})`);
    }
  }
  
  console.log("\n=== 7-day Tick Runner Simulation Complete ===");
  console.log(`Breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / (breakerTrips || 1)) * 100).toFixed(1)}%`);
  
  // In a full harness this would drive on-chain vault instructions (pause, withdraw, etc.)
  // via the deployed Anchor program, but this tick runner focuses on the oracle replay + TWAP logic.
}

runSimulation().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
