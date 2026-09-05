import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { LagInjector, LagInjectorConfig, PriceData } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices } from "./oracle-utils";

const TARGET_LAG_MS = 45_000;
const TICK_INTERVAL_MS = 15_000;
const SIM_DURATION_DAYS = 7;
const MS_PER_DAY = 86_400_000;

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  console.log("=== JitoSOL Depeg Protection Sim Harness ===");
  console.log(`Target oracle lag: ${TARGET_LAG_MS}ms`);
  console.log(`TWAP window: 15s`);
  console.log(`Simulation duration: ${SIM_DURATION_DAYS} days\n`);

  const config: LagInjectorConfig = {
    targetLagMs: TARGET_LAG_MS,
    slotMs: 400,
  };

  const injector = new LagInjector(connection, payer, config);

  const series: PriceData[] = await getHistoricalJitoPrices();
  await injector.loadSeries(series);

  console.log(`Loaded ${series.length} historical JitoSOL price points.\n`);
  console.log("Starting 15s-tick simulation...\n");

  const startTime = Date.now();
  const endTime = startTime + SIM_DURATION_DAYS * MS_PER_DAY;
  let tick = 0;
  let breakerTrips = 0;
  let falsePositives = 0;

  let lastLogTime = Date.now();

  while (Date.now() < endTime) {
    const now = Date.now();
    const currentPrice = injector.getCurrentPrice(now);

    const isFalsePositive = checkTWAPFalsePositive(
      injector,
      now,
      15_000,
      0.05 // 5% drawdown threshold for breaker
    );

    if (isFalsePositive) {
      falsePositives++;
    }

    // Simulate drawdown circuit-breaker trip on real depeg (simple proxy)
    if (currentPrice && currentPrice.price < 0.90) {
      breakerTrips++;
      console.log(`[${new Date(now).toISOString()}] BREAKER TRIP - price ${currentPrice.price.toFixed(4)}`);
    }

    tick++;

    // Progress log every 10 simulated ticks (~2.5 min wall time in sim)
    if (now - lastLogTime > 150_000) {
      const progress = Math.round(((now - startTime) / (endTime - startTime)) * 100);
      console.log(`[${new Date(now).toISOString()}] tick ${tick} | progress ${progress}% | trips ${breakerTrips} | falsePos ${falsePositives}`);
      lastLogTime = now;
    }

    // Advance simulated time by one tick
    await new Promise((resolve) => setTimeout(resolve, 10)); // fast-forward sim
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n=== Simulation Complete ===");
  console.log(`Ticks simulated: ${tick}`);
  console.log(`Wall time: ${durationSec}s`);
  console.log(`Circuit-breaker trips: ${breakerTrips}`);
  console.log(`15s-TWAP false positives: ${falsePositives}`);
  console.log(`False-positive rate: ${((falsePositives / tick) * 100).toFixed(3)}%`);
}

main().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
