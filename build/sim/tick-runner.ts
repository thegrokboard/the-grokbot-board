import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { LagInjectorConfig, OracleLagInjector, HistoricalPriceSeries, getHistoricalPriceSeries } from "./oracle-utils";
import { OracleLagInjectorImpl } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { Vault } from "../target/types/vault";

interface TWAPConfig {
  windowSlots: number;
  thresholdBps: number;
}

interface SimConfig {
  slotDurationMs: number;
  lagSlots: number;
  daysToSimulate: number;
  twapConfig: TWAPConfig;
}

const DEFAULT_SIM_CONFIG: SimConfig = {
  slotDurationMs: 400,
  lagSlots: 112, // ~45s at 400ms/slot
  daysToSimulate: 7,
  twapConfig: {
    windowSlots: 225, // ~90s
    thresholdBps: 500, // 5%
  },
};

async function runSimulation(): Promise<void> {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as anchor.Program<Vault>;
  const connection = provider.connection;

  const config: LagInjectorConfig = {
    lagSlots: DEFAULT_SIM_CONFIG.lagSlots,
    basePrice: 1.0,
    volatility: 0.02,
  };

  const historicalSeries: HistoricalPriceSeries = getHistoricalPriceSeries();
  const lagInjector: OracleLagInjector = new OracleLagInjectorImpl(
    connection,
    new PublicKey("11111111111111111111111111111111"),
    config,
    historicalSeries
  );

  console.log("Starting pure-onchain JitoSOL depeg protection sim harness...");
  console.log(`Target oracle lag: ${DEFAULT_SIM_CONFIG.lagSlots * (DEFAULT_SIM_CONFIG.slotDurationMs / 1000)}s`);
  console.log(`Simulating ${DEFAULT_SIM_CONFIG.daysToSimulate} days (${DEFAULT_SIM_CONFIG.daysToSimulate * 24 * 3600 * 1000 / DEFAULT_SIM_CONFIG.slotDurationMs} slots)`);

  let currentSlot = 0;
  const totalSlots = DEFAULT_SIM_CONFIG.daysToSimulate * 24 * 3600 * 1000 / DEFAULT_SIM_CONFIG.slotDurationMs;
  let breakerTrips = 0;
  let falsePositives = 0;
  let totalChecks = 0;

  // Initialize vault state (simplified on-chain setup)
  const vaultKeypair = Keypair.generate();
  // In a real run we would call program methods here; for sim we drive oracle only

  while (currentSlot < totalSlots) {
    // Advance the lagged oracle
    lagInjector.advanceSlot(currentSlot);

    // Simulate price injection at current slot using historical replay
    const nextPrice = lagInjector.getCurrentPrice();
    if (nextPrice !== null) {
      await lagInjector.injectPriceAtSlot(currentSlot, nextPrice);
    }

    // Run TWAP false-positive checker every 15s (approx every 37-38 slots)
    if (currentSlot % 38 === 0) {
      totalChecks++;
      const recentPrices = lagInjector.getPriceHistory(DEFAULT_SIM_CONFIG.twapConfig.windowSlots);
      const isFalsePositive = checkTWAPFalsePositive(
        recentPrices,
        DEFAULT_SIM_CONFIG.twapConfig
      );

      if (isFalsePositive) {
        falsePositives++;
        console.log(`Slot ${currentSlot}: TWAP breaker TRIPPED (false positive)`);
      } else if (Math.random() < 0.005) { // simulated real depeg event
        breakerTrips++;
        console.log(`Slot ${currentSlot}: REAL depeg - breaker TRIPPED`);
      }
    }

    currentSlot++;
    if (currentSlot % 10000 === 0) {
      console.log(`Progress: ${((currentSlot / totalSlots) * 100).toFixed(1)}% | Trips: ${breakerTrips} | False+: ${falsePositives}`);
    }
  }

  console.log("\n=== SIMULATION COMPLETE ===");
  console.log(`Total TWAP checks: ${totalChecks}`);
  console.log(`Circuit breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log(`False positive rate: ${totalChecks > 0 ? ((falsePositives / totalChecks) * 100).toFixed(3) : 0}%`);
}

runSimulation().then(() => {
  console.log("tick-runner completed successfully.");
  process.exit(0);
}).catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
