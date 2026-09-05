import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, HistoricalPriceSeries, PriceData, TWAPConfig } from "./oracle-utils";

const TICK_INTERVAL_MS = 15000; // 15s ticks
const SIM_DURATION_DAYS = 7;
const TARGET_LAG_SLOTS = 450; // ~45s at 100ms/slot

async function main() {
  console.log("Starting pure-onchain Anchor JitoSOL depeg sim harness...");

  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const payer = Keypair.generate();

  // Fund payer for test validator
  await connection.requestAirdrop(payer.publicKey, 10_000_000_000);

  const oraclePubkey = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYkXw1tJ3v");

  console.log("Loading historical JitoSOL price series...");
  const series: HistoricalPriceSeries = getHistoricalJitoPrices();

  console.log(`Loaded ${series.length} price points from last three depeg events.`);

  const lagInjector = new LagInjector(connection, oraclePubkey, TARGET_LAG_SLOTS);
  await lagInjector.loadSeries(series);

  const twapConfig: TWAPConfig = {
    windowSlots: 450, // 45s TWAP
    thresholdBps: 500, // 5% drawdown
  };

  console.log(`Running ${SIM_DURATION_DAYS}-day simulation with ${TICK_INTERVAL_MS}ms ticks...`);
  console.log("Monitoring for circuit breaker trips vs TWAP false positives.\n");

  let tick = 0;
  const maxTicks = (SIM_DURATION_DAYS * 86400 * 1000) / TICK_INTERVAL_MS;

  const breakerTrips: number[] = [];
  const falsePositives: number[] = [];

  const interval = setInterval(async () => {
    try {
      await lagInjector.replay(tick);

      const laggedPrices: PriceData[] = lagInjector.getLaggedPrices();
      if (laggedPrices.length === 0) {
        console.log(`Tick ${tick}: No lagged prices yet.`);
        tick++;
        return;
      }

      const isFalsePositive = checkTWAPFalsePositive(laggedPrices, twapConfig);
      const isBreakerTrip = !isFalsePositive && laggedPrices[laggedPrices.length - 1].price < 0.92; // simulated drawdown

      if (isBreakerTrip) breakerTrips.push(tick);
      if (isFalsePositive) falsePositives.push(tick);

      console.log(
        `Tick ${tick} | ` +
        `Lagged Price: ${laggedPrices[laggedPrices.length - 1].price.toFixed(4)} | ` +
        `Breaker: ${isBreakerTrip ? "TRIP" : "ok"} | ` +
        `TWAP FP: ${isFalsePositive ? "YES" : "no"}`
      );

      tick++;
      if (tick >= maxTicks) {
        clearInterval(interval);
        console.log("\nSimulation complete.");
        console.log(`Breaker trips: ${breakerTrips.length}`);
        console.log(`False positives (15s TWAP): ${falsePositives.length}`);
        console.log("Results logged. Check vault program logs for onchain circuit breaker state.");
        process.exit(0);
      }
    } catch (err) {
      console.error("Tick error:", err);
    }
  }, TICK_INTERVAL_MS);
}

main().catch((err) => {
  console.error("Sim failed:", err);
  process.exit(1);
});
