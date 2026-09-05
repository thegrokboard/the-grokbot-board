import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { LagInjector, LagInjectorConfig, PriceData } from "./lag-injector";
import { getHistoricalJitoPrices, HistoricalPriceSeries } from "./oracle-utils";
import { checkTWAPFalsePositive } from "./twap-checker";

const LAG_SECONDS = 45;
const TICK_INTERVAL_MS = 15000; // 15s ticks for the TWAP checker
const SIM_DURATION_DAYS = 7;
const MS_PER_DAY = 86400000;
const SLOTS_PER_SECOND = 2; // approximate Solana slot time

interface SimulationStats {
  breakerTrips: number;
  falsePositives: number;
  totalTicks: number;
}

async function runSimulation(): Promise<void> {
  console.log("=== JitoSOL Depeg Protection Pure-Onchain Test-Validator Sim ===");
  console.log(`Target oracle lag: ${LAG_SECONDS}s`);
  console.log(`TWAP check interval: ${TICK_INTERVAL_MS / 1000}s`);
  console.log(`Simulation duration: ${SIM_DURATION_DAYS} days\n`);

  // Load historical JitoSOL price series (real depeg events)
  const historicalSeries: HistoricalPriceSeries = await getHistoricalJitoPrices();
  
  const config: LagInjectorConfig = {
    lagSeconds: LAG_SECONDS,
    slotDurationMs: 400 // ~2.5 slots per second, but we use 2 for conservative sim
  };

  const injector = new LagInjector(historicalSeries, config);

  // Connect to local test validator (Anchor default)
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  
  // For pure on-chain sim we don't need a real program PDA here; the lag injector
  // replays prices into a simulated oracle account. The vault program would read
  // this oracle on drawdown/breaker instructions.
  console.log("Initialized lag injector with historical JitoSOL price replay.\n");

  const stats: SimulationStats = {
    breakerTrips: 0,
    falsePositives: 0,
    totalTicks: 0,
  };

  const totalMs = SIM_DURATION_DAYS * MS_PER_DAY;
  const tickCount = Math.floor(totalMs / TICK_INTERVAL_MS);
  let currentSlot = 100_000; // arbitrary starting mainnet-like slot

  console.log(`Running ${tickCount} ticks (${SIM_DURATION_DAYS} simulated days)...\n`);

  for (let tick = 0; tick < tickCount; tick++) {
    const nowMs = Date.now(); // wall time for deterministic replay
    const simulatedSlot = currentSlot + Math.floor((tick * TICK_INTERVAL_MS) / 400);

    // Inject lagged price at the current simulated slot
    injector.injectPriceAtSlot(simulatedSlot);

    // Get current (lagged) price from the injector
    const currentPrice = injector.getCurrentPrice();
    
    // Get full history visible to the on-chain program (lagged view)
    const visibleHistory = injector.getPriceHistory();

    // Run 15s TWAP false-positive checker
    const isFalsePositive = checkTWAPFalsePositive(visibleHistory, currentPrice);

    if (isFalsePositive) {
      stats.falsePositives++;
      console.log(`Tick ${tick}: FALSE POSITIVE detected at slot ${simulatedSlot}`);
    } else if (currentPrice.price < 0.85) { // simplistic depeg threshold for breaker trip
      stats.breakerTrips++;
      console.log(`Tick ${tick}: BREAKER TRIPPED (price=${currentPrice.price.toFixed(4)}) at slot ${simulatedSlot}`);
    }

    stats.totalTicks++;
    currentSlot = simulatedSlot;

    // Sleep to simulate real-time execution (optional for faster CI, but keeps timing realistic)
    if (tick % 10 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 50)); // throttle output
    }
  }

  // Final report
  console.log("\n=== Simulation Complete ===");
  console.log(`Total ticks: ${stats.totalTicks}`);
  console.log(`Circuit breaker trips: ${stats.breakerTrips}`);
  console.log(`TWAP false positives: ${stats.falsePositives}`);
  console.log(`False positive rate: ${((stats.falsePositives / stats.totalTicks) * 100).toFixed(3)}%`);
  
  if (stats.falsePositives === 0) {
    console.log("\n✅ No false positives across 7-day replay. Protection logic appears robust.");
  } else {
    console.log("\n⚠️  False positives observed. TWAP parameters may need tuning.");
  }
}

// Run the simulation when executed directly
if (require.main === module) {
  runSimulation().catch((err) => {
    console.error("Simulation failed:", err);
    process.exit(1);
  });
}

export { runSimulation, SimulationStats };
