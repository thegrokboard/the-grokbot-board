import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";
import fs from "fs";
import path from "path";

// ------------------------------------------------------------------
// Configs (kept minimal and matching committed files)
// ------------------------------------------------------------------

interface LagInjectorConfig {
  lagSlots: number;
  replaySpeed: number; // slots per tick
  oraclePubkey: PublicKey;
}

interface TWAPConfig {
  windowSlots: number;
  thresholdBps: number;
}

interface SimResult {
  breakerTrips: number;
  falsePositives: number;
  totalTicks: number;
  logPath: string;
}

// ------------------------------------------------------------------
// Main 7-day tick runner
// ------------------------------------------------------------------

export class TickRunner {
  private connection: Connection;
  private lagInjector: LagInjector;
  private twapConfig: TWAPConfig;
  private results: SimResult;

  constructor(
    connection: Connection,
    lagConfig: LagInjectorConfig,
    twapConfig: TWAPConfig
  ) {
    this.connection = connection;
    this.lagInjector = new LagInjector(connection, lagConfig);
    this.twapConfig = twapConfig;
    this.results = {
      breakerTrips: 0,
      falsePositives: 0,
      totalTicks: 0,
      logPath: path.join(__dirname, "sim-log.json"),
    };
  }

  async run(days: number = 7): Promise<SimResult> {
    console.log(`Starting ${days}-day JitoSOL depeg simulation...`);

    // Load historical price series (last three depeg events concatenated)
    const rawSeries: PriceData[] = await getHistoricalJitoPrices();
    if (rawSeries.length === 0) {
      throw new Error("No historical Jito price data available");
    }

    // Replay the entire series with injected oracle lag
    const laggedSeries = await this.lagInjector.replayWithLag(rawSeries);

    const slotWindow = this.twapConfig.windowSlots;
    const thresholdBps = this.twapConfig.thresholdBps;

    let logEntries: any[] = [];

    for (let i = 0; i < laggedSeries.length; i += 1) {
      const currentPrice = laggedSeries[i];
      this.results.totalTicks++;

      // Simple sliding TWAP over last N slots (approximated by index)
      const windowStart = Math.max(0, i - slotWindow);
      const window = laggedSeries.slice(windowStart, i + 1);
      
      const isFalsePositive = checkTWAPFalsePositive(
        window,
        currentPrice,
        { windowSlots: slotWindow, thresholdBps }
      );

      if (isFalsePositive) {
        this.results.falsePositives++;
      }

      // Simulate drawdown circuit-breaker trip (price drop > 5% from TWAP)
      const twap = window.reduce((sum, p) => sum + p.price, 0) / window.length;
      if (currentPrice.price < twap * 0.95) {
        this.results.breakerTrips++;
      }

      // Log every 100 ticks to keep output manageable
      if (this.results.totalTicks % 100 === 0) {
        logEntries.push({
          tick: this.results.totalTicks,
          price: currentPrice.price,
          twap,
          laggedSlot: currentPrice.slot,
          falsePositive: isFalsePositive,
          breakerTripped: currentPrice.price < twap * 0.95,
        });
      }

      // Simulate real-time delay (15s per tick in real sim would be throttled)
      if (this.results.totalTicks % 500 === 0) {
        console.log(
          `Tick ${this.results.totalTicks}: ` +
          `price=${currentPrice.price.toFixed(4)}, ` +
          `trips=${this.results.breakerTrips}, ` +
          `falsePos=${this.results.falsePositives}`
        );
      }
    }

    this.saveLog(logEntries);
    this.printSummary();
    return this.results;
  }

  private saveLog(entries: any[]) {
    const logData = {
      simConfig: {
        days: 7,
        lagSlots: 450, // ~45s at 100ms/slot
        twapWindow: this.twapConfig.windowSlots,
        thresholdBps: this.twapConfig.thresholdBps,
      },
      results: this.results,
      ticks: entries,
    };
    fs.writeFileSync(this.results.logPath, JSON.stringify(logData, null, 2));
    console.log(`Simulation log written to ${this.results.logPath}`);
  }

  private printSummary() {
    console.log("\n=== Simulation Complete ===");
    console.log(`Total ticks: ${this.results.totalTicks}`);
    console.log(`Circuit breaker trips: ${this.results.breakerTrips}`);
    console.log(`False positives (15s TWAP): ${this.results.falsePositives}`);
    console.log(`False positive rate: ${((this.results.falsePositives / this.results.totalTicks) * 100).toFixed(3)}%`);
  }
}

// ------------------------------------------------------------------
// CLI entrypoint (matches package.json script)
// ------------------------------------------------------------------

async function main() {
  const rpcUrl = "http://127.0.0.1:8899";
  const connection = new Connection(rpcUrl, "confirmed");

  const lagConfig: LagInjectorConfig = {
    lagSlots: 450, // target 45s lag
    replaySpeed: 1,
    oraclePubkey: new PublicKey("J1tQfXz8v4v5k9pQ2wE3rT6yU7iO9pL2kM3nB4vC5xD"), // placeholder oracle
  };

  const twapConfig: TWAPConfig = {
    windowSlots: 150, // 15s TWAP at 100ms/slot
    thresholdBps: 50,
  };

  const runner = new TickRunner(connection, lagConfig, twapConfig);
  await runner.run(7);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Simulation failed:", err);
    process.exit(1);
  });
}
