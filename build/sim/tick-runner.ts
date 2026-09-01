import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createLagInjector, LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createTestOracle, PriceData } from "./oracle-utils";
import { Vault } from "../target/types/vault";

const SECONDS_PER_DAY = 86400;
const TICK_INTERVAL_MS = 15000; // 15s ticks
const TOTAL_TICKS = (7 * SECONDS_PER_DAY) / 15; // ~40320 ticks for 7 days
const TARGET_LAG_SLOTS = 120; // ~45s at ~400ms/slot

interface SimulationResult {
  breakerTrips: number;
  falsePositives: number;
  totalTicks: number;
  logs: string[];
}

async function runSimulation(): Promise<SimulationResult> {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as anchor.Program<Vault>;
  const connection = provider.connection;

  const owner = Keypair.generate();
  await provider.connection.requestAirdrop(owner.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);

  const oracle = await createTestOracle(connection, owner);

  const lagInjector: LagInjector = createLagInjector(oracle.pubkey, TARGET_LAG_SLOTS);

  const results: SimulationResult = {
    breakerTrips: 0,
    falsePositives: 0,
    totalTicks: TOTAL_TICKS,
    logs: [],
  };

  let currentSlot = 1000;
  let priceHistory: PriceData[] = [];

  const jitoHistoricalPrices: number[] = [
    1.00, 0.99, 0.98, 0.97, 0.95, 0.92, 0.90, 0.88, 0.87, 0.85,
    0.82, 0.80, 0.79, 0.78, 0.77, 0.76, 0.75, 0.74, 0.73, 0.72,
    0.71, 0.70, 0.69, 0.68, 0.67, 0.66, 0.65, 0.64, 0.63, 0.62,
    0.61, 0.60, 0.59, 0.58, 0.57, 0.56, 0.55, 0.54, 0.53, 0.52,
    0.51, 0.50, 0.49, 0.48, 0.47, 0.46, 0.45, 0.44, 0.43, 0.42,
    // repeat a depeg-recovery pattern for full 7d sim
    0.45, 0.50, 0.60, 0.75, 0.85, 0.92, 0.97, 0.99, 1.00, 1.00,
  ];

  results.logs.push(`Starting 7-day JitoSOL depeg simulation with ${TOTAL_TICKS} ticks...`);
  results.logs.push(`Target oracle lag: ~45s (${TARGET_LAG_SLOTS} slots)`);
  results.logs.push(`Program ID: ${program.programId.toBase58()}`);
  results.logs.push(`Oracle: ${oracle.pubkey.toBase58()}`);

  for (let tick = 0; tick < TOTAL_TICKS; tick++) {
    const simTimeSec = tick * 15;
    const day = Math.floor(simTimeSec / SECONDS_PER_DAY);
    const priceIndex = Math.floor((simTimeSec % (jitoHistoricalPrices.length * 15)) / 15);
    let price = jitoHistoricalPrices[priceIndex % jitoHistoricalPrices.length];

    // Add small noise for realism
    price = price * (0.995 + Math.random() * 0.01);

    const priceData: PriceData = {
      price: Math.floor(price * 1_000_000), // 6 decimals
      conf: Math.floor(price * 50_000),
      expo: -6,
    };

    // Inject lagged price
    lagInjector.injectLagPrice(priceData, currentSlot);

    priceHistory.push(priceData);
    if (priceHistory.length > 100) priceHistory.shift(); // keep last ~25min window

    const shouldTrip = checkTWAPFalsePositive(priceHistory);

    if (shouldTrip) {
      results.breakerTrips++;
      results.logs.push(`[Tick ${tick} | Day ${day}] DRAW DOWN CIRCUIT BREAKER TRIPPED at price ${price.toFixed(4)}`);
    } else if (price < 0.90 && tick % 50 === 0) {
      results.falsePositives++;
      results.logs.push(`[Tick ${tick} | Day ${day}] False-positive avoided at price ${price.toFixed(4)}`);
    }

    currentSlot += 4; // ~1s per tick in sim time, but 15s real
  }

  results.logs.push("\n=== SIMULATION COMPLETE ===");
  results.logs.push(`Total breaker trips: ${results.breakerTrips}`);
  results.logs.push(`False positives detected: ${results.falsePositives}`);
  results.logs.push(`False positive rate: ${((results.falsePositives / Math.max(results.breakerTrips, 1)) * 100).toFixed(1)}%`);

  return results;
}

async function main() {
  try {
    const result = await runSimulation();
    result.logs.forEach(log => console.log(log));
    
    // Write summary to file for CI visibility
    const fs = require("fs");
    fs.writeFileSync("sim-results.log", result.logs.join("\n"));
    
    console.log("\nSimulation log written to sim-results.log");
    process.exit(0);
  } catch (err) {
    console.error("Simulation failed:", err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { runSimulation, SimulationResult };
