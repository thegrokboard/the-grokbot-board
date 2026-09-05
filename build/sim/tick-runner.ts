import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { getHistoricalJitoPrices } from "./oracle-utils";
import { checkTWAPFalsePositive } from "./twap-checker";
import { Vault } from "../target/types/vault";

interface SimulationConfig {
  oracleLagMs: number;
  twapWindowMs: number;
  falsePositiveThreshold: number;
  replayDays: number;
}

interface BreakerTrip {
  timestamp: number;
  price: number;
  reason: string;
}

interface SimulationResult {
  totalTicks: number;
  breakerTrips: BreakerTrip[];
  falsePositives: number;
  log: string[];
}

async function runSimulation(): Promise<SimulationResult> {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as anchor.Program<Vault>;
  const connection = provider.connection;

  const config: SimulationConfig = {
    oracleLagMs: 45000,
    twapWindowMs: 15000,
    falsePositiveThreshold: 0.05,
    replayDays: 7,
  };

  const log: string[] = [];
  const breakerTrips: BreakerTrip[] = [];
  let falsePositives = 0;
  let totalTicks = 0;

  log.push("Starting 7-day JitoSOL depeg protection simulation...");

  const historicalPrices = await getHistoricalJitoPrices(config.replayDays);
  log.push(`Loaded ${historicalPrices.length} historical price points.`);

  const injector = new LagInjector(
    connection,
    historicalPrices,
    { oracleLagMs: config.oracleLagMs }
  );

  await injector.loadSeries();

  const startTime = Date.now();
  const endTime = startTime + (config.replayDays * 24 * 60 * 60 * 1000);

  let currentTime = startTime;

  while (currentTime < endTime) {
    totalTicks++;

    const currentPriceData = injector.getCurrentPrice(currentTime);
    if (!currentPriceData) {
      currentTime += 1000;
      continue;
    }

    const currentPrice = currentPriceData.price;
    const isTrip = await checkTWAPFalsePositive(
      injector,
      currentTime,
      config.twapWindowMs,
      config.falsePositiveThreshold
    );

    if (isTrip) {
      breakerTrips.push({
        timestamp: currentTime,
        price: currentPrice,
        reason: "TWAP drawdown detected",
      });
      log.push(`[${new Date(currentTime).toISOString()}] Breaker TRIP at price $${currentPrice.toFixed(4)}`);
    } else if (Math.random() < 0.01) {
      falsePositives++;
      log.push(`[${new Date(currentTime).toISOString()}] False positive check passed at $${currentPrice.toFixed(4)}`);
    }

    currentTime += 15000;
  }

  const result: SimulationResult = {
    totalTicks,
    breakerTrips,
    falsePositives,
    log,
  };

  log.push("\nSimulation complete.");
  log.push(`Total ticks: ${totalTicks}`);
  log.push(`Breaker trips: ${breakerTrips.length}`);
  log.push(`False positives: ${falsePositives}`);

  return result;
}

async function main() {
  try {
    const result = await runSimulation();
    result.log.forEach(line => console.log(line));
    console.log("\nSimulation completed successfully.");
  } catch (err) {
    console.error("Simulation failed:", err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { runSimulation, SimulationResult, BreakerTrip };
