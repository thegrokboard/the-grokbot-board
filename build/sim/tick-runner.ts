import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { LagInjector, LagInjectorConfig } from "./lag-injector";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";
import { checkTWAPFalsePositive } from "./twap-checker";

interface TickRunnerConfig {
  oracleLagMs: number;
  twapWindowMs: number;
  simDurationMs: number;
  tickIntervalMs: number;
  jitoMint: PublicKey;
  owner: Keypair;
}

export class TickRunner {
  private connection: Connection;
  private lagInjector: LagInjector;
  private config: TickRunnerConfig;
  private priceSeries: PriceData[] = [];
  private lastTickTime: number = 0;
  private breakerTrips: number = 0;
  private falsePositives: number = 0;
  private totalTicks: number = 0;

  constructor(connection: Connection, config: TickRunnerConfig) {
    this.connection = connection;
    const injectorConfig: LagInjectorConfig = {
      targetLagMs: config.oracleLagMs,
      priceSeries: [],
    };
    this.lagInjector = new LagInjector(injectorConfig);
    this.config = config;
  }

  async loadSeries(): Promise<void> {
    this.priceSeries = await getHistoricalJitoPrices();
    this.lagInjector.loadSeries(this.priceSeries);
    console.log(`Loaded ${this.priceSeries.length} historical JitoSOL price points`);
  }

  async run(): Promise<void> {
    await this.loadSeries();
    console.log("Starting 7-day tick simulation with lag injector and TWAP checker...");

    const startTime = Date.now();
    const endTime = startTime + this.config.simDurationMs;

    while (Date.now() < endTime) {
      await this.tick();
      await new Promise(resolve => setTimeout(resolve, this.config.tickIntervalMs));
    }

    this.logResults();
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    if (now - this.lastTickTime < this.config.tickIntervalMs) {
      return;
    }
    this.lastTickTime = now;
    this.totalTicks++;

    try {
      const currentPrice = this.lagInjector.getCurrentPrice();
      if (!currentPrice) {
        console.warn("No current price available from lag injector");
        return;
      }

      const isFalsePositive = checkTWAPFalsePositive(
        this.priceSeries,
        currentPrice,
        this.config.twapWindowMs,
        this.config.oracleLagMs
      );

      if (isFalsePositive) {
        this.falsePositives++;
        console.log(`[${new Date(now).toISOString()}] TWAP false positive detected at price ${currentPrice.price}`);
      } else if (currentPrice.price < 0.9) {
        this.breakerTrips++;
        console.log(`[${new Date(now).toISOString()}] Circuit breaker TRIPPED at price ${currentPrice.price}`);
      }
    } catch (err) {
      console.error("Tick error:", err);
    }
  }

  private logResults(): void {
    console.log("\n=== Simulation Complete ===");
    console.log(`Total ticks: ${this.totalTicks}`);
    console.log(`Circuit breaker trips: ${this.breakerTrips}`);
    console.log(`TWAP false positives: ${this.falsePositives}`);
    console.log(`False positive rate: ${this.totalTicks > 0 ? ((this.falsePositives / this.totalTicks) * 100).toFixed(2) : 0}%`);
    console.log("============================\n");
  }
}

// CLI entrypoint for the 7-day sim
async function main() {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");

  const runnerConfig: TickRunnerConfig = {
    oracleLagMs: 45000,
    twapWindowMs: 15000,
    simDurationMs: 7 * 24 * 60 * 60 * 1000,
    tickIntervalMs: 15000,
    jitoMint: new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6YgH2vA"),
    owner: Keypair.generate(),
  };

  const runner = new TickRunner(connection, runnerConfig);
  await runner.run();
}

if (require.main === module) {
  main().catch(console.error);
}
