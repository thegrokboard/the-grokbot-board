import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";
import fs from "fs";

const RPC_URL = "http://127.0.0.1:8899";
const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn");
const ORACLE_PROGRAM = new PublicKey("7XqX3Z8vU6v4z7v9vU6v4z7v9vU6v4z7v9vU6v4z7v9");
const VAULT_PROGRAM_ID = new PublicKey("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

interface SimulationConfig {
  lagSeconds: number;
  twapWindowSeconds: number;
  drawdownThresholdBps: number;
  replayDays: number;
  tickIntervalMs: number;
}

const DEFAULT_CONFIG: SimulationConfig = {
  lagSeconds: 45,
  twapWindowSeconds: 15,
  drawdownThresholdBps: 500, // 5%
  replayDays: 7,
  tickIntervalMs: 15000,
};

class TickRunner {
  private connection: Connection;
  private injector: LagInjector;
  private config: SimulationConfig;
  private breakerTrips: number = 0;
  private falsePositives: number = 0;
  private totalTicks: number = 0;

  constructor(config: Partial<SimulationConfig> = {}) {
    this.connection = new Connection(RPC_URL, "confirmed");
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.injector = new LagInjector(this.connection, this.config.lagSeconds);
  }

  async run(): Promise<void> {
    console.log("Starting 7-day JitoSOL depeg simulation with lag injector...");
    console.log(`Config: lag=${this.config.lagSeconds}s, TWAP=${this.config.twapWindowSeconds}s, threshold=${this.config.drawdownThresholdBps}bps`);

    const series: PriceData[] = await getHistoricalJitoPrices(this.config.replayDays);
    if (series.length === 0) {
      throw new Error("No historical price data available");
    }

    console.log(`Loaded ${series.length} price points for replay.`);

    // Replay the series with configurable oracle lag
    const laggedPrices = await this.injector.replayWithLag(series, this.config.lagSeconds);

    let lastPrice: PriceData | null = null;
    const startTime = Date.now();

    for (let i = 0; i < laggedPrices.length; i++) {
      const currentPrice = laggedPrices[i];
      this.totalTicks++;

      // Check for circuit breaker trip using 15s TWAP
      const isTrip = checkTWAPFalsePositive(
        laggedPrices,
        i,
        this.config.twapWindowSeconds,
        this.config.drawdownThresholdBps
      );

      if (isTrip) {
        this.breakerTrips++;
        console.log(`[${new Date(currentPrice.timestamp * 1000).toISOString()}] CIRCUIT BREAKER TRIPPED at price $${currentPrice.price.toFixed(4)}`);
      } else if (lastPrice && this.isSignificantDrawdown(lastPrice, currentPrice)) {
        this.falsePositives++;
        console.log(`[${new Date(currentPrice.timestamp * 1000).toISOString()}] False positive avoided at $${currentPrice.price.toFixed(4)}`);
      }

      lastPrice = currentPrice;

      // Simulate real-time ticking
      if (i % 10 === 0) {
        console.log(`Progress: ${Math.round((i / laggedPrices.length) * 100)}% | Trips: ${this.breakerTrips} | FP: ${this.falsePositives}`);
      }

      // Throttle to simulate 15s ticks
      if (i < laggedPrices.length - 1) {
        await new Promise(resolve => setTimeout(resolve, this.config.tickIntervalMs / 10));
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logResults(duration);
  }

  private isSignificantDrawdown(prev: PriceData, curr: PriceData): boolean {
    if (prev.price === 0) return false;
    const dropBps = ((prev.price - curr.price) / prev.price) * 10000;
    return dropBps > this.config.drawdownThresholdBps / 2;
  }

  private logResults(duration: string): void {
    console.log("\n=== Simulation Complete ===");
    console.log(`Duration: ${duration}s`);
    console.log(`Total ticks: ${this.totalTicks}`);
    console.log(`Circuit breaker trips: ${this.breakerTrips}`);
    console.log(`False positives avoided: ${this.falsePositives}`);
    console.log(`False positive rate: ${this.totalTicks > 0 ? ((this.falsePositives / this.totalTicks) * 100).toFixed(2) : 0}%`);

    const results = {
      config: this.config,
      trips: this.breakerTrips,
      falsePositives: this.falsePositives,
      totalTicks: this.totalTicks,
      timestamp: new Date().toISOString(),
    };

    fs.writeFileSync("sim-results.json", JSON.stringify(results, null, 2));
    console.log("Results written to sim-results.json");
  }
}

// Run the simulation if this file is executed directly
if (require.main === module) {
  const runner = new TickRunner();
  runner.run().catch((err) => {
    console.error("Simulation failed:", err);
    process.exit(1);
  });
}

export { TickRunner, SimulationConfig };
