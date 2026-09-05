import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData, TWAPConfig } from "./oracle-utils";
import * as fs from "fs";

const LAG_TARGET_SLOTS = 90; // ~45s at 500ms/slot
const TICK_INTERVAL_MS = 15000;
const SIM_DURATION_DAYS = 7;
const TICKS_PER_DAY = (24 * 60 * 60 * 1000) / TICK_INTERVAL_MS;
const TOTAL_TICKS = SIM_DURATION_DAYS * TICKS_PER_DAY;

interface SimResult {
  tick: number;
  timestamp: number;
  laggedPrice: number;
  twap: number;
  breakerTripped: boolean;
  isFalsePositive: boolean;
}

async function runSimulation() {
  console.log("Starting pure-onchain Anchor JitoSOL depeg sim harness...");

  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const payer = Keypair.generate();

  // Fund payer for test validator
  const airdropSig = await connection.requestAirdrop(payer.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdropSig);

  const injector = new LagInjector(connection, LAG_TARGET_SLOTS);
  const historicalPrices: PriceData[] = getHistoricalJitoPrices();

  console.log(`Loaded ${historicalPrices.length} historical JitoSOL price points for replay.`);

  await injector.loadSeries(historicalPrices);

  const results: SimResult[] = [];
  let breakerTrips = 0;
  let falsePositives = 0;

  const config: TWAPConfig = {
    windowSlots: 180, // 90s TWAP
    thresholdBps: 500, // 5% drawdown
    minConfidence: 0.8,
  };

  console.log(`Running ${TOTAL_TICKS} ticks (${SIM_DURATION_DAYS} days) at ${TICK_INTERVAL_MS}ms interval...`);

  for (let tick = 0; tick < TOTAL_TICKS; tick++) {
    const now = Date.now();
    await injector.replay(now);

    const laggedPrices = injector.getLaggedPrices();
    if (laggedPrices.length === 0) {
      console.warn(`Tick ${tick}: No lagged prices available`);
      continue;
    }

    const latestLagged = laggedPrices[laggedPrices.length - 1];
    const twapValue = calculateSimpleTWAP(laggedPrices);

    const breakerTripped = twapValue < latestLagged.price * 0.92; // 8% drawdown circuit breaker
    const isFalsePositive = checkTWAPFalsePositive(laggedPrices, config);

    if (breakerTripped) breakerTrips++;
    if (breakerTripped && isFalsePositive) falsePositives++;

    results.push({
      tick,
      timestamp: now,
      laggedPrice: latestLagged.price,
      twap: twapValue,
      breakerTripped,
      isFalsePositive,
    });

    if (tick % 100 === 0) {
      console.log(`Tick ${tick}/${TOTAL_TICKS}: price=${latestLagged.price.toFixed(4)}, TWAP=${twapValue.toFixed(4)}, tripped=${breakerTripped}`);
    }

    // Sleep to simulate real-time ticks
    if (tick < TOTAL_TICKS - 1) {
      await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS));
    }
  }

  const summary = {
    totalTicks: TOTAL_TICKS,
    breakerTrips,
    falsePositives,
    falsePositiveRate: breakerTrips > 0 ? (falsePositives / breakerTrips) * 100 : 0,
    finalPrice: results[results.length - 1]?.laggedPrice || 0,
  };

  console.log("\n=== Simulation Complete ===");
  console.log(`Breaker trips: ${summary.breakerTrips}`);
  console.log(`False positives: ${summary.falsePositives}`);
  console.log(`False positive rate: ${summary.falsePositiveRate.toFixed(2)}%`);

  fs.writeFileSync("sim-results.json", JSON.stringify(summary, null, 2));
  console.log("Results written to sim-results.json");
}

// Simple TWAP helper (real impl would use on-chain account state)
function calculateSimpleTWAP(prices: PriceData[]): number {
  if (prices.length === 0) return 0;
  const sum = prices.reduce((acc, p) => acc + p.price, 0);
  return sum / prices.length;
}

runSimulation().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
