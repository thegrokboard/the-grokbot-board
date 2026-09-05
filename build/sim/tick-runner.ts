import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { LagInjector, LagInjectorConfig } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";
import * as fs from "fs";
import * as path from "path";

interface SimulationResult {
  breakerTrips: number;
  falsePositives: number;
  totalTicks: number;
  logPath: string;
}

const TICK_INTERVAL_MS = 15000; // 15s ticks
const TOTAL_SIM_DURATION_DAYS = 7;
const MS_PER_DAY = 86400000;
const TOTAL_TICKS = Math.floor((TOTAL_SIM_DURATION_DAYS * MS_PER_DAY) / TICK_INTERVAL_MS);

async function runSimulation(): Promise<SimulationResult> {
  console.log("Starting 7-day JitoSOL depeg simulation...");

  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  
  // Load historical price series (real Jito depeg events)
  const historicalSeries: PriceData[] = getHistoricalJitoPrices();
  console.log(`Loaded ${historicalSeries.length} historical price points`);

  const config: LagInjectorConfig = {
    targetLagMs: 45000, // 45s target oracle lag
    slotMs: 400,        // approximate slot time
    replaySpeed: 1.0
  };

  const injector = new LagInjector(config);
  await injector.loadSeries(historicalSeries);

  const logs: string[] = [];
  let breakerTrips = 0;
  let falsePositives = 0;
  let currentTick = 0;
  let simTimeMs = 0;

  const logPath = path.join(__dirname, "sim-logs", `run_${Date.now()}.log`);
  if (!fs.existsSync(path.dirname(logPath))) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
  }

  console.log(`Running ${TOTAL_TICKS} ticks (${TOTAL_SIM_DURATION_DAYS} days @ 15s resolution)...`);

  while (currentTick < TOTAL_TICKS) {
    const laggedPrice = injector.getCurrentPrice(simTimeMs);
    
    if (laggedPrice) {
      const isFalsePositive = checkTWAPFalsePositive(
        historicalSeries,
        laggedPrice,
        0.05, // 5% drawdown threshold
        4     // 4-tick TWAP window
      );

      const shouldTripBreaker = laggedPrice.price < 0.92; // example circuit breaker threshold

      if (shouldTripBreaker) {
        breakerTrips++;
        logs.push(`[TICK ${currentTick}] BREWER TRIP at price=${laggedPrice.price.toFixed(4)} (slot ~${laggedPrice.slot})`);
      } else if (isFalsePositive) {
        falsePositives++;
        logs.push(`[TICK ${currentTick}] FALSE POSITIVE detected at price=${laggedPrice.price.toFixed(4)}`);
      }
    }

    simTimeMs += TICK_INTERVAL_MS;
    currentTick++;

    if (currentTick % 500 === 0) {
      console.log(`Progress: ${((currentTick / TOTAL_TICKS) * 100).toFixed(1)}% - Trips: ${breakerTrips}, False Pos: ${falsePositives}`);
    }
  }

  logs.unshift(`=== JitoSOL Vault Simulation Report ===`);
  logs.unshift(`Duration: ${TOTAL_SIM_DURATION_DAYS} days`);
  logs.unshift(`Ticks: ${TOTAL_TICKS}`);
  logs.unshift(`Breaker trips: ${breakerTrips}`);
  logs.unshift(`False positives: ${falsePositives}`);
  logs.unshift(`False positive rate: ${((falsePositives / (breakerTrips + falsePositives)) * 100 || 0).toFixed(2)}%`);
  logs.push(`=== End of simulation ===`);

  fs.writeFileSync(logPath, logs.join("\n"));
  console.log(`Simulation complete. Log written to ${logPath}`);

  return {
    breakerTrips,
    falsePositives,
    totalTicks: TOTAL_TICKS,
    logPath
  };
}

async function main() {
  try {
    const result = await runSimulation();
    console.log("\n=== SIMULATION SUMMARY ===");
    console.log(`Breaker trips: ${result.breakerTrips}`);
    console.log(`False positives: ${result.falsePositives}`);
    console.log(`Total ticks: ${result.totalTicks}`);
    console.log(`Log: ${result.logPath}`);
    
    if (result.falsePositives > 3) {
      console.warn("WARNING: High false positive count - TWAP parameters may need tuning");
    }
  } catch (err) {
    console.error("Simulation failed:", err);
    process.exit(1);
  }
}

main();
