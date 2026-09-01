import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection, Transaction, SystemProgram } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createPriceAccount, updatePriceAccount } from "./oracle-utils";

interface OracleConfig {
  oracleProgramId: PublicKey;
  priceFeed: PublicKey;
  admin: Keypair;
}

interface PriceData {
  price: number;
  confidence: number;
  timestamp: number;
  slot: number;
}

const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet as anchor.Wallet;

  const connection = provider.connection;

  // Config for oracle (Pyth-like for sim)
  const oracleConfig: OracleConfig = {
    oracleProgramId: new PublicKey("FsJ3A3u2vn5cTVofAjK6fF9fU8j2J5f9J4v3k5s5k5"),
    priceFeed: new PublicKey("4f5v3k5s5k5J2J5f9J4v3k5s5k5J2J5f9J4v3k5s5k5"),
    admin: Keypair.generate(), // sim admin
  };

  const lagInjector: LagInjector = createLagInjector(connection, oracleConfig.oracleProgramId, oracleConfig.admin);

  // Load historical Jito depeg series (last 3 simulated depegs)
  const historicalSeries: PriceData[][] = [
    // Series 1: normal
    [
      { price: 0.98, confidence: 0.01, timestamp: Date.now() / 1000, slot: 100 },
      { price: 0.97, confidence: 0.02, timestamp: Date.now() / 1000 + 15, slot: 115 },
      { price: 0.99, confidence: 0.01, timestamp: Date.now() / 1000 + 30, slot: 130 },
    ],
    // Series 2: depeg (should trip)
    [
      { price: 0.95, confidence: 0.05, timestamp: Date.now() / 1000, slot: 200 },
      { price: 0.85, confidence: 0.10, timestamp: Date.now() / 1000 + 15, slot: 215 },
      { price: 0.75, confidence: 0.15, timestamp: Date.now() / 1000 + 30, slot: 230 },
    ],
    // Series 3: flash crash false-positive test
    [
      { price: 0.92, confidence: 0.03, timestamp: Date.now() / 1000, slot: 300 },
      { price: 0.65, confidence: 0.20, timestamp: Date.now() / 1000 + 5, slot: 305 },
      { price: 0.94, confidence: 0.02, timestamp: Date.now() / 1000 + 20, slot: 320 },
    ],
  ];

  console.log("Starting 7-day tick simulation with lag injector...");

  let breakerTrips = 0;
  let falsePositives = 0;
  let totalTicks = 0;

  // Simulate 7 days at 15s intervals (~40320 ticks)
  const TICKS_PER_DAY = 5760; // 86400 / 15
  for (let day = 0; day < 7; day++) {
    for (let tick = 0; tick < TICKS_PER_DAY; tick++) {
      totalTicks++;
      const seriesIndex = Math.floor(Math.random() * historicalSeries.length);
      const series = historicalSeries[seriesIndex];

      // Inject lagged price
      const lagSeconds = 45;
      const injectedSlot = Math.floor(Date.now() / 400) - (lagSeconds * 2); // rough slot lag

      await lagInjector.injectLagPrice(
        oracleConfig.priceFeed,
        series[series.length - 1].price,
        series[series.length - 1].confidence,
        Math.floor(Date.now() / 1000) - lagSeconds,
        injectedSlot
      );

      // Run TWAP false-positive checker
      const isFalsePositive = checkTWAPFalsePositive(series, 0.10, 30); // 10% drawdown, 30s window

      if (isFalsePositive) {
        falsePositives++;
        console.log(`Tick ${totalTicks}: False positive detected (series ${seriesIndex})`);
      } else if (series[series.length - 1].price < 0.90) {
        breakerTrips++;
        console.log(`Tick ${totalTicks}: Breaker TRIPPED on depeg (series ${seriesIndex})`);
      }

      // Simulate vault state update (no-op for sim harness)
      if (totalTicks % 1000 === 0) {
        console.log(`Progress: day ${day + 1}/7, ticks: ${totalTicks}, trips: ${breakerTrips}, falsePos: ${falsePositives}`);
      }

      // Sleep to simulate real-time (optional for fast runs)
      // await new Promise(r => setTimeout(r, 10));
    }
  }

  console.log("\n=== Simulation Complete ===");
  console.log(`Total ticks: ${totalTicks}`);
  console.log(`Circuit breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / totalTicks) * 100).toFixed(3)}%`);
}

// Create lag injector (exported for testability)
export function createLagInjector(connection: Connection, programId: PublicKey, admin: Keypair): LagInjector {
  return {
    injectLagPrice: async (priceFeed: PublicKey, price: number, confidence: number, timestamp: number, slot: number) => {
      const priceData: PriceData = { price, confidence, timestamp, slot };
      await updatePriceAccount(connection, programId, priceFeed, admin, priceData);
    },
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
