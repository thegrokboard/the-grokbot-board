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

const TICK_INTERVAL_MS = 15000; // 15s TWAP check
const TOTAL_TICKS = 7 * 24 * 60 * 4; // 7 days @ 15s ticks = 40320
const LAG_TARGET_SLOTS = 90; // ~45s at 500ms/slot

async function runSimulation(): Promise<SimulationResult> {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  // Load historical JitoSOL price series
  const series: PriceData[] = await getHistoricalJitoPrices();
  console.log(`Loaded ${series.length} historical price points for replay`);

  // Configure lag injector (45s target lag, slot-exact)
  const config: LagInjectorConfig = {
    lagSlots: LAG_TARGET_SLOTS,
    replaySpeed: 1.0,
    oracleProgramId: new PublicKey("11111111111111111111111111111111"), // placeholder for sim
    priceFeedAccount: new PublicKey("22222222222222222222222222222222"), // placeholder
  };

  const lagInjector = new LagInjector(config, connection, payer);
  await lagInjector.loadSeries(series);

  // Simulation state
  let breakerTrips = 0;
  let falsePositives = 0;
  let totalTicks = 0;
  const logs: string[] = [];
  const startTime = Date.now();

  console.log("Starting 7-day onchain simulation with lag-injected oracle...");

  // Tick runner: drive 15s TWAP checks over replayed series
  for (let tick = 0; tick < TOTAL_TICKS; tick++) {
    const currentSlot = await connection.getSlot();
    const laggedPrice = await lagInjector.getCurrentPrice(currentSlot);

    if (!laggedPrice) {
      logs.push(`Tick ${tick}: No price available at slot ${currentSlot}`);
      continue;
    }

    const isFalsePositive = checkTWAPFalsePositive(
      series,
      laggedPrice,
      0.05, // 5% drawdown threshold
      4     // 4-tick (60s) TWAP window
    );

    if (isFalsePositive) {
      falsePositives++;
      logs.push(`Tick ${tick} (slot ${currentSlot}): FALSE POSITIVE - TWAP would not have tripped breaker`);
    } else if (laggedPrice.price < series[series.length - 1].price * 0.92) {
      // Simulated drawdown circuit-breaker trip
      breakerTrips++;
      logs.push(`Tick ${tick} (slot ${currentSlot}): BREAKER TRIP - drawdown detected with lagged price ${laggedPrice.price}`);
    } else {
      logs.push(`Tick ${tick} (slot ${currentSlot}): normal price ${laggedPrice.price}`);
    }

    totalTicks++;
    
    // Simulate real-time passage (15s per tick)
    if (tick % 100 === 0) {
      console.log(`Progress: ${Math.round((tick / TOTAL_TICKS) * 100)}% - Trips: ${breakerTrips}, False Pos: ${falsePositives}`);
    }

    await new Promise(resolve => setTimeout(resolve, 10)); // fast-forward sim
  }

  const durationMs = Date.now() - startTime;
  const logPath = path.join(__dirname, "../sim-logs.txt");
  fs.writeFileSync(logPath, logs.join("\n"));

  console.log(`Simulation complete in ${Math.round(durationMs / 1000)}s`);
  console.log(`Breaker trips: ${breakerTrips}, False positives: ${falsePositives}, Total ticks: ${totalTicks}`);
  console.log(`Full log written to ${logPath}`);

  return {
    breakerTrips,
    falsePositives,
    totalTicks,
    logPath,
  };
}

// Run if called directly
if (require.main === module) {
  runSimulation().catch((err) => {
    console.error("Simulation failed:", err);
    process.exit(1);
  });
}

export { runSimulation };
export type { SimulationResult };
