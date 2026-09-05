import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";

interface SimulationConfig {
  lagSeconds: number;
  twapWindowSeconds: number;
  falsePositiveThreshold: number;
  startSlot: number;
  numTicks: number;
  tickIntervalMs: number;
}

interface SimulationResult {
  breakerTrips: number;
  falsePositives: number;
  totalTicks: number;
  logs: string[];
}

async function runSimulation(config: SimulationConfig): Promise<SimulationResult> {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const payer = Keypair.generate();

  // Fund payer for test validator
  const airdropSig = await connection.requestAirdrop(payer.publicKey, 10_000_000_000);
  await connection.confirmTransaction(airdropSig);

  const historicalPrices: PriceData[] = getHistoricalJitoPrices();
  const injector = new LagInjector(connection, payer, {
    lagSeconds: config.lagSeconds,
    startSlot: config.startSlot,
  });

  // Replay the series with lag
  await injector.replay(historicalPrices);

  const results: SimulationResult = {
    breakerTrips: 0,
    falsePositives: 0,
    totalTicks: 0,
    logs: [],
  };

  const startTime = Date.now();
  const twapWindowMs = config.twapWindowSeconds * 1000;

  for (let i = 0; i < config.numTicks; i++) {
    const currentSlot = config.startSlot + i;
    const currentTime = startTime + i * config.tickIntervalMs;
    const laggedPrices = injector.getLaggedPrices(currentTime);

    if (laggedPrices.length < 2) {
      results.logs.push(`Tick ${i}: insufficient lagged data`);
      continue;
    }

    const isFalsePositive = checkTWAPFalsePositive(
      laggedPrices,
      config.twapWindowSeconds,
      config.falsePositiveThreshold
    );

    if (isFalsePositive) {
      results.breakerTrips++;
      results.logs.push(`Tick ${i} (slot ${currentSlot}): DRAW DOWN CIRCUIT BREAKER TRIPPED`);
    } else {
      results.falsePositives++;
      results.logs.push(`Tick ${i} (slot ${currentSlot}): false positive (no trip)`);
    }

    results.totalTicks++;
    
    // Simulate 15s tick delay
    if (config.tickIntervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.tickIntervalMs));
    }
  }

  results.logs.push(`Simulation complete. Breaker trips: ${results.breakerTrips}, False positives: ${results.falsePositives}`);
  return results;
}

async function main() {
  const config: SimulationConfig = {
    lagSeconds: 45,
    twapWindowSeconds: 15,
    falsePositiveThreshold: 0.05,
    startSlot: 1000,
    numTicks: 672, // 7 days at 15s ticks (approx)
    tickIntervalMs: 0, // 0 for fast sim; set >0 for real-time
  };

  console.log("Starting 7-day JitoSOL depeg simulation with lag injector and TWAP checker...");
  console.log(`Config: lag=${config.lagSeconds}s, twap=${config.twapWindowSeconds}s, ticks=${config.numTicks}`);

  const result = await runSimulation(config);

  console.log("\n=== SIMULATION RESULTS ===");
  console.log(`Breaker trips: ${result.breakerTrips}`);
  console.log(`False positives: ${result.falsePositives}`);
  console.log(`Total ticks processed: ${result.totalTicks}`);
  console.log("\nSample logs:");
  result.logs.slice(0, 10).forEach((log) => console.log(log));
  if (result.logs.length > 10) {
    console.log(`... and ${result.logs.length - 10} more logs`);
  }

  // In a real CI harness this would assert acceptable false-positive rate
  if (result.breakerTrips > 5) {
    console.warn("WARNING: High number of circuit breaker trips detected");
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Simulation failed:", err);
    process.exit(1);
  });
}

export { runSimulation, SimulationConfig, SimulationResult };
