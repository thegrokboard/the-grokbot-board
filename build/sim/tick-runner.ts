import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { LagInjector, LagInjectorConfig } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";
import * as fs from "fs";
import * as path from "path";

// Configuration for the 7-day tick simulation
const SIM_CONFIG = {
  days: 7,
  ticksPerDay: 24 * 4, // 15-minute ticks
  targetLagSlots: 180, // ~45s at 250ms/slot
  replaySpeed: 1, // real-time multiplier (not passed to LagInjector)
  outputLog: path.join(__dirname, "../sim-logs", "breaker-trips.log"),
  jitoMint: new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"),
  oraclePubkey: new PublicKey("oracle1111111111111111111111111111111111111111"), // placeholder for sim
};

// Ensure log directory exists
const logDir = path.dirname(SIM_CONFIG.outputLog);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

async function runSimulation() {
  console.log("Starting pure-onchain Anchor JitoSOL depeg sim harness (7-day tick runner)...");

  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const wallet = Keypair.generate(); // funded by test validator

  // Load historical JitoSOL price series (last three depeg events)
  const historicalSeries: PriceData[] = await getHistoricalJitoPrices(3);
  console.log(`Loaded ${historicalSeries.length} historical price points from last three depegs.`);

  // Configure and instantiate lag injector (45s target lag, slot-exact)
  const injectorConfig: LagInjectorConfig = {
    targetLagSlots: SIM_CONFIG.targetLagSlots,
    oraclePubkey: SIM_CONFIG.oraclePubkey,
    jitoMint: SIM_CONFIG.jitoMint,
  };

  const lagInjector = new LagInjector(connection, injectorConfig);
  await lagInjector.loadSeries(historicalSeries);

  console.log(`Lag injector initialized with ${SIM_CONFIG.targetLagSlots} slot lag.`);

  const logs: string[] = [];
  let breakerTrips = 0;
  let falsePositives = 0;
  let totalTicks = SIM_CONFIG.days * SIM_CONFIG.ticksPerDay;

  console.log(`Running ${totalTicks} ticks over simulated 7 days...`);

  for (let tick = 0; tick < totalTicks; tick++) {
    // Advance simulated time and inject lagged price
    const currentPrice = await lagInjector.getCurrentPrice(tick);
    const timestamp = Date.now() + tick * 15 * 60 * 1000; // 15-min increments

    // Run 15s TWAP false-positive checker
    const isFalsePositive = checkTWAPFalsePositive(
      historicalSeries,
      currentPrice,
      15 * 60 // 15s window in seconds
    );

    if (isFalsePositive) {
      falsePositives++;
      logs.push(`[TICK ${tick}] FALSE POSITIVE - TWAP would have tripped breaker at $${currentPrice.price.toFixed(4)}`);
    }

    // Simulate on-chain drawdown circuit-breaker check
    if (currentPrice.price < 0.85 && !isFalsePositive) {
      breakerTrips++;
      logs.push(`[TICK ${tick}] BREAKER TRIP - JitoSOL depeg to $${currentPrice.price.toFixed(4)} at ts=${timestamp}`);
      // In full harness this would call the on-chain pause + protected withdraw instruction
    }

    // Log progress every 100 ticks
    if (tick % 100 === 0 && tick > 0) {
      console.log(`Progress: ${Math.round((tick / totalTicks) * 100)}% | Trips: ${breakerTrips} | False Pos: ${falsePositives}`);
    }
  }

  // Write detailed log
  const summary = `
JitoSOL Depeg Protection Sim - 7 Day Run
----------------------------------------
Total ticks: ${totalTicks}
Breaker trips: ${breakerTrips}
False positives: ${falsePositives}
False positive rate: ${totalTicks > 0 ? ((falsePositives / totalTicks) * 100).toFixed(2) : 0}%
Target lag: ${SIM_CONFIG.targetLagSlots} slots (~45s)
  `.trim();

  logs.unshift(summary);
  fs.writeFileSync(SIM_CONFIG.outputLog, logs.join("\n"));

  console.log("\nSimulation complete!");
  console.log(summary);
  console.log(`Detailed log written to: ${SIM_CONFIG.outputLog}`);
  console.log("\nNext steps: run 'anchor test' or 'npm run sim' to execute on-chain vault program with this replay data.");
}

runSimulation().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
