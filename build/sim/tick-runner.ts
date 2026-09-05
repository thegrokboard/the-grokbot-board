import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";
import * as fs from "fs";

interface SimConfig {
  oracleLagSlots: number;
  twapWindowSlots: number;
  falsePositiveThreshold: number;
  tickIntervalMs: number;
  totalTicks: number;
  logFile: string;
}

const DEFAULT_CONFIG: SimConfig = {
  oracleLagSlots: 225, // ~45s at 200ms/slot
  twapWindowSlots: 75,
  falsePositiveThreshold: 0.02,
  tickIntervalMs: 15000,
  totalTicks: 40320, // 7 days at 15s ticks
  logFile: "./sim-logs/breaker-trips.log",
};

class TickRunner {
  private connection: Connection;
  private injector: LagInjector;
  private config: SimConfig;
  private logs: string[] = [];
  private breakerTrips: number = 0;
  private falsePositives: number = 0;
  private totalChecks: number = 0;

  constructor(connection: Connection, config: Partial<SimConfig> = {}) {
    this.connection = connection;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.injector = new LagInjector(this.config.oracleLagSlots);
  }

  async run(): Promise<void> {
    console.log("Starting 7-day JitoSOL depeg simulation with lag injector...");
    console.log(`Target lag: ${this.config.oracleLagSlots} slots (~45s)`);
    console.log(`TWAP window: ${this.config.twapWindowSlots} slots`);
    console.log(`Total ticks: ${this.config.totalTicks} (15s interval)`);

    // Ensure log directory
    const logDir = this.config.logFile.substring(0, this.config.logFile.lastIndexOf("/"));
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const historicalPrices: PriceData[] = await getHistoricalJitoPrices();
    console.log(`Loaded ${historicalPrices.length} historical price points for replay.`);

    this.injector.loadSeries(historicalPrices);

    const startTime = Date.now();

    for (let tick = 0; tick < this.config.totalTicks; tick++) {
      // Advance the lagged oracle view
      const laggedPrices = this.injector.injectLag();

      // Run TWAP false-positive check
      const isFalsePositive = checkTWAPFalsePositive(
        laggedPrices,
        this.config.twapWindowSlots,
        this.config.falsePositiveThreshold
      );

      this.totalChecks++;
      if (isFalsePositive) {
        this.falsePositives++;
        this.breakerTrips++;
        this.logs.push(`[TICK ${tick}] BREAKER TRIP - false positive detected at TWAP check`);
      } else {
        this.logs.push(`[TICK ${tick}] OK - no breaker trip`);
      }

      if (tick % 1000 === 0) {
        console.log(`Progress: ${tick}/${this.config.totalTicks} ticks | Trips: ${this.breakerTrips}`);
      }

      // Simulate 15s tick delay
      await new Promise(resolve => setTimeout(resolve, this.config.tickIntervalMs));
    }

    const durationMs = Date.now() - startTime;
    this.writeReport(durationMs);
    console.log("Simulation completed.");
  }

  private writeReport(durationMs: number): void {
    const report = [
      "=== JitoSOL Depeg Protection Simulation Report ===",
      `Total ticks: ${this.config.totalTicks}`,
      `Duration: ${(durationMs / 1000 / 60).toFixed(1)} minutes (simulated 7 days)`,
      `Oracle lag: ${this.config.oracleLagSlots} slots`,
      `TWAP window: ${this.config.twapWindowSlots} slots`,
      `Total TWAP checks: ${this.totalChecks}`,
      `Breaker trips: ${this.breakerTrips}`,
      `False positives: ${this.falsePositives}`,
      `False positive rate: ${((this.falsePositives / this.totalChecks) * 100).toFixed(3)}%`,
      "",
      "Log entries:",
      ...this.logs
    ].join("\n");

    fs.writeFileSync(this.config.logFile, report);
    console.log(`Detailed log written to ${this.config.logFile}`);
  }
}

// CLI entry point
async function main() {
  const rpcUrl = "http://127.0.0.1:8899";
  const connection = new Connection(rpcUrl, "confirmed");

  // Verify test validator is running
  try {
    await connection.getSlot();
  } catch (e) {
    console.error("Test validator not running. Please start with `anchor test` or `solana-test-validator`.");
    process.exit(1);
  }

  const runner = new TickRunner(connection);
  await runner.run();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Simulation failed:", err);
    process.exit(1);
  });
}

export { TickRunner, DEFAULT_CONFIG };
