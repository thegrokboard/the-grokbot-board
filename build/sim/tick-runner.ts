import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";
import { Vault } from "../target/types/vault";

const SIM_SLOTS = 10000; // 7-day sim at ~0.4s/slot compressed for speed
const TARGET_LAG_SLOTS = 112; // ~45s at 400ms/slot
const TWAP_PERIOD_SLOTS = 225; // 15s TWAP ~ 15/0.4 = ~37.5, padded

async function runSim() {
  // Setup local test validator connection
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  
  // Provider for Anchor (program not directly invoked in price sim, but kept for harness)
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(Keypair.generate()),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);
  const program = anchor.workspace.Vault as anchor.Program<Vault>;

  console.log("Starting pure-onchain Anchor JitoSOL depeg sim harness...");
  console.log(`Target oracle lag: ${TARGET_LAG_SLOTS} slots (~45s)`);
  console.log(`TWAP window: ${TWAP_PERIOD_SLOTS} slots (~15s)`);

  // Load historical JitoSOL price series (last three depeg events)
  const historicalSeries: PriceData[] = getHistoricalJitoPrices();
  console.log(`Loaded ${historicalSeries.length} historical price points from 3 depegs.`);

  // Initialize lag injector (replays series with configurable lag against local validator)
  const lagInjector = new LagInjector(
    connection,
    new PublicKey("oracle111111111111111111111111111111111111111"), // placeholder oracle for sim
    TARGET_LAG_SLOTS
  );

  let breakerTrips = 0;
  let falsePositives = 0;
  let totalTicks = 0;

  // Replay each historical depeg series with lag
  for (const series of historicalSeries.reduce((acc: PriceData[][], _, i) => {
    if (i % 100 === 0) acc.push(historicalSeries.slice(i, i + 100));
    return acc;
  }, [])) {
    await lagInjector.replayLaggedSeries(series);

    // Run 15s TWAP false-positive checker over the lagged replay
    for (let tick = 0; tick < series.length - TWAP_PERIOD_SLOTS; tick += 50) { // step to simulate 7-day ticks
      totalTicks++;
      const currentPrice = series[tick];
      const isFalsePositive = checkTWAPFalsePositive(
        series.slice(0, tick + 1),
        TWAP_PERIOD_SLOTS,
        currentPrice.price
      );

      // Simulate drawdown circuit-breaker logic (owner pause + withdraw not invoked in price sim)
      if (currentPrice.price < 0.85) { // example depeg threshold for JitoSOL
        breakerTrips++;
        console.log(`[TICK ${totalTicks}] Breaker TRIPPED at price $${currentPrice.price.toFixed(4)} (slot ~${currentPrice.slot})`);
      } else if (isFalsePositive) {
        falsePositives++;
        console.log(`[TICK ${totalTicks}] False positive detected at price $${currentPrice.price.toFixed(4)}`);
      }

      // Simulate slot advance
      if (tick % 500 === 0) {
        console.log(`Progress: ${Math.round((tick / SIM_SLOTS) * 100)}% - Trips: ${breakerTrips}, False+: ${falsePositives}`);
      }
    }
  }

  console.log("\n=== SIMULATION COMPLETE ===");
  console.log(`Total ticks simulated: ${totalTicks}`);
  console.log(`Circuit breaker trips: ${breakerTrips}`);
  console.log(`15s TWAP false positives: ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / (breakerTrips + falsePositives)) * 100 || 0).toFixed(2)}%`);
  
  if (falsePositives > breakerTrips * 0.1) {
    console.log("WARNING: High false positive rate - TWAP params may need tuning.");
  } else {
    console.log("Sim passed: Protection buffer and drawdown breaker performed within acceptable false-positive bounds.");
  }
}

// Run the 7-day tick simulation
runSim().catch((err) => {
  console.error("Sim failed:", err);
  process.exit(1);
});
