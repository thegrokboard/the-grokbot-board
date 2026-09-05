import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";

interface TWAPConfig {
  windowSlots: number;
  thresholdBps: number;
}

interface SimConfig {
  lagSeconds: number;
  twap: TWAPConfig;
  days: number;
  slotMs: number;
}

const DEFAULT_CONFIG: SimConfig = {
  lagSeconds: 45,
  twap: {
    windowSlots: 150, // ~1 minute at 400ms/slot
    thresholdBps: 300,
  },
  days: 7,
  slotMs: 400,
};

async function runSimulation(config: SimConfig = DEFAULT_CONFIG) {
  console.log("=== JitoSOL Depeg Protection Simulator ===");
  console.log(`Lag target: ${config.lagSeconds}s | TWAP: ${config.twap.windowSlots} slots, ${config.twap.thresholdBps}bps threshold`);
  console.log(`Running for ${config.days} days (${Math.floor(config.days * 86400 / (config.slotMs / 1000))} slots)\n`);

  const prices: PriceData[] = getHistoricalJitoPrices();
  if (prices.length === 0) {
    console.error("No historical price data available.");
    return;
  }

  const injector = new LagInjector(config.lagSeconds);
  injector.loadSeries(prices);

  let breakerTrips = 0;
  let falsePositives = 0;
  let totalChecks = 0;

  const startSlot = prices[0].slot;
  const endSlot = startSlot + Math.floor((config.days * 86400 * 1000) / config.slotMs);
  const step = Math.max(1, Math.floor(config.twap.windowSlots / 3));

  for (let slot = startSlot; slot < endSlot; slot += step) {
    const lagged = injector.getLaggedPrices(slot);
    if (lagged.length < config.twap.windowSlots) continue;

    const tripped = checkTWAPFalsePositive(lagged, config.twap);
    totalChecks++;

    if (tripped) {
      breakerTrips++;
      // Simulate drawdown circuit breaker activation
      console.log(`[SLOT ${slot}] DRAW DOWN CIRCUIT BREAKER TRIPPED (lag=${config.lagSeconds}s)`);
    }

    // Count false positives when price is within 1% of recent mean but still trips
    if (tripped) {
      const recentMean = lagged.slice(-10).reduce((sum, p) => sum + p.price, 0) / 10;
      const lastPrice = lagged[lagged.length - 1].price;
      if (Math.abs(lastPrice - recentMean) / recentMean < 0.01) {
        falsePositives++;
      }
    }
  }

  console.log("\n=== Simulation Complete ===");
  console.log(`Total TWAP checks: ${totalChecks}`);
  console.log(`Circuit breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log(`False positive rate: ${totalChecks > 0 ? ((falsePositives / breakerTrips) * 100).toFixed(2) : 0}%`);
}

async function main() {
  try {
    await runSimulation();
  } catch (err) {
    console.error("Simulation failed:", err);
    process.exit(1);
  }
}

main();
