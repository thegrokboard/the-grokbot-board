import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";
import * as fs from "fs";

interface SimConfig {
  lagSeconds: number;
  twapPeriodSeconds: number;
  falsePositiveThreshold: number;
  replayDays: number;
  tickIntervalMs: number;
}

const CONFIG: SimConfig = {
  lagSeconds: 45,
  twapPeriodSeconds: 15,
  falsePositiveThreshold: 0.02,
  replayDays: 7,
  tickIntervalMs: 15000,
};

class TickRunner {
  private connection: Connection;
  private injector: LagInjector;
  private priceHistory: PriceData[] = [];
  private trippedBreakers: number = 0;
  private falsePositives: number = 0;
  private totalTicks: number = 0;
  private lastTwapCheck: number = 0;

  constructor(rpcUrl: string = "http://127.0.0.1:8899") {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.injector = new LagInjector(this.connection, CONFIG.lagSeconds);
  }

  async init(): Promise<void> {
    console.log("Initializing 7-day JitoSOL depeg simulation...");
    const historical = await getHistoricalJitoPrices();
    this.priceHistory = historical;
    console.log(`Loaded ${this.priceHistory.length} historical price points.`);
    await this.injector.loadSeries(this.priceHistory);
  }

  async run(): Promise<void> {
    await this.init();

    console.log(`Starting tick runner with ${CONFIG.replayDays} day replay, ${CONFIG.lagSeconds}s oracle lag...`);
    const startTime = Date.now();
    const endTime = startTime + (CONFIG.replayDays * 24 * 60 * 60 * 1000);

    let currentTick = startTime;

    while (currentTick < endTime) {
      await this.tick(currentTick);
      currentTick += CONFIG.tickIntervalMs;
      // Simulate real-time delay for readability in sim
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    this.logResults();
  }

  private async tick(timestamp: number): Promise<void> {
    this.totalTicks++;

    // Advance the lagged oracle
    await this.injector.replay(timestamp);

    const laggedPrices = this.injector.getLaggedPrices();

    if (laggedPrices.length < 5) {
      return;
    }

    // Run 15s TWAP false-positive checker
    const isFalsePositive = checkTWAPFalsePositive(
      laggedPrices,
      CONFIG.twapPeriodSeconds
    );

    if (isFalsePositive) {
      this.falsePositives++;
      console.log(`[${new Date(timestamp).toISOString()}] TWAP false-positive detected`);
    }

    // Simulate drawdown circuit-breaker logic (simple threshold for sim)
    const latest = laggedPrices[laggedPrices.length - 1];
    const drawdown = this.calculateDrawdown(laggedPrices);

    if (drawdown > 0.15 && !isFalsePositive) {
      this.trippedBreakers++;
      console.log(`[${new Date(timestamp).toISOString()}] CIRCUIT BREAKER TRIPPED - drawdown: ${(drawdown * 100).toFixed(2)}%`);
    }

    if (this.totalTicks % 100 === 0) {
      this.logProgress();
    }
  }

  private calculateDrawdown(prices: PriceData[]): number {
    if (prices.length < 2) return 0;
    const peak = Math.max(...prices.map((p) => p.price));
    const current = prices[prices.length - 1].price;
    return peak > 0 ? (peak - current) / peak : 0;
  }

  private logProgress(): void {
    const fpRate = this.totalTicks > 0 ? (this.falsePositives / this.totalTicks) * 100 : 0;
    console.log(`Progress: ticks=${this.totalTicks}, breakers=${this.trippedBreakers}, falsePos=${this.falsePositives} (${fpRate.toFixed(2)}%)`);
  }

  private logResults(): void {
    const fpRate = this.totalTicks > 0 ? (this.falsePositives / this.totalTicks) * 100 : 0;
    console.log("\n=== Simulation Complete ===");
    console.log(`Total ticks: ${this.totalTicks}`);
    console.log(`Circuit breaker trips: ${this.trippedBreakers}`);
    console.log(`False positives: ${this.falsePositives} (${fpRate.toFixed(2)}%)`);
    console.log(`Target lag: ${CONFIG.lagSeconds}s | TWAP window: ${CONFIG.twapPeriodSeconds}s`);
    console.log("Results written to sim-results.json");

    const results = {
      totalTicks: this.totalTicks,
      trippedBreakers: this.trippedBreakers,
      falsePositives: this.falsePositives,
      falsePositiveRate: fpRate,
      config: CONFIG,
      timestamp: new Date().toISOString(),
    };

    fs.writeFileSync("sim-results.json", JSON.stringify(results, null, 2));
  }
}

async function main() {
  try {
    const runner = new TickRunner();
    await runner.run();
  } catch (err) {
    console.error("Simulation failed:", err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { TickRunner, CONFIG };
