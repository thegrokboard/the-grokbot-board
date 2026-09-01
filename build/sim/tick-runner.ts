import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createLagInjector, LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createTestOracle, PriceData, TestOracle } from "./oracle-utils";

const SIM_SLOTS = 7 * 24 * 60 * 4; // ~7 days at 15s ticks (4 ticks per minute)
const TARGET_LAG_SLOTS = 3; // ~45s at 15s slots
const TICK_INTERVAL_MS = 15000;

interface SimConfig {
  initialPrice: number;
  depegSeries: PriceData[];
  oracleLagSlots: number;
}

async function runSimulation() {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const payer = Keypair.generate();

  // Airdrop for test validator
  await connection.requestAirdrop(payer.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);

  const oracle = await createTestOracle(connection, payer);
  const lagInjector: LagInjector = createLagInjector(connection, oracle, payer, TARGET_LAG_SLOTS);

  // Sample depeg price series (last three known JitoSOL depegs simplified for sim)
  const depegSeries: PriceData[] = [
    { price: 0.98, conf: 0.01, timestamp: Date.now() / 1000 },
    { price: 0.92, conf: 0.02, timestamp: Date.now() / 1000 + 30 },
    { price: 0.85, conf: 0.03, timestamp: Date.now() / 1000 + 90 },
    { price: 0.81, conf: 0.04, timestamp: Date.now() / 1000 + 150 },
    { price: 0.95, conf: 0.01, timestamp: Date.now() / 1000 + 300 },
  ];

  const config: SimConfig = {
    initialPrice: 1.0,
    depegSeries,
    oracleLagSlots: TARGET_LAG_SLOTS,
  };

  console.log("Starting pure-onchain Anchor JitoSOL depeg sim harness...");
  console.log(`Target lag: ${config.oracleLagSlots * 15}s | Total ticks: ${SIM_SLOTS}`);

  let breakerTrips = 0;
  let falsePositives = 0;
  let currentPrice = config.initialPrice;
  let slot = 0;

  // Initialize oracle with starting price
  await lagInjector.setPrice(currentPrice, 0.005);

  for (let tick = 0; tick < SIM_SLOTS; tick++) {
    slot += 1;
    const now = Date.now();

    // Replay depeg series with lag injection
    if (tick < config.depegSeries.length) {
      const nextPriceData = config.depegSeries[tick];
      await lagInjector.injectLagPrice(nextPriceData.price, nextPriceData.conf);
      currentPrice = nextPriceData.price;
    } else {
      // After series, slowly recover
      currentPrice = Math.min(1.0, currentPrice + 0.002);
      await lagInjector.setPrice(currentPrice, 0.01);
    }

    // Run 15s TWAP false-positive checker
    const isFalsePositive = checkTWAPFalsePositive(
      oracle,
      currentPrice,
      15 * 60, // 15 minute TWAP window in seconds
      0.05     // 5% drawdown threshold
    );

    if (isFalsePositive) {
      falsePositives++;
      console.log(`[${tick}] FALSE POSITIVE detected at price $${currentPrice.toFixed(3)}`);
    }

    // Simulate drawdown circuit-breaker logic (would call program instruction in full harness)
    if (currentPrice < 0.90 && !isFalsePositive) {
      breakerTrips++;
      console.log(`[${tick}] CIRCUIT BREAKER TRIPPED at $${currentPrice.toFixed(3)} (lag: ${config.oracleLagSlots * 15}s)`);
    }

    if (tick % 20 === 0) {
      console.log(`Tick ${tick}/${SIM_SLOTS} | Price: $${currentPrice.toFixed(3)} | Trips: ${breakerTrips} | False+: ${falsePositives}`);
    }

    await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS));
  }

  console.log("\n=== SIMULATION COMPLETE ===");
  console.log(`Breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / (breakerTrips + falsePositives)) * 100 || 0).toFixed(1)}%`);
}

runSimulation().catch((err) => {
  console.error("Sim failed:", err);
  process.exit(1);
});
