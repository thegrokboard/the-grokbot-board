import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { LagInjector, LagInjectorConfig } from "./lag-injector";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";
import { checkTWAPFalsePositive } from "./twap-checker";

interface SimulationConfig {
  lagSeconds: number;
  twapWindowSeconds: number;
  simDurationDays: number;
  tickIntervalMs: number;
}

interface SimulationStats {
  totalTicks: number;
  breakerTrips: number;
  falsePositives: number;
  lastPrice: number;
  lastTWAP: number;
}

class TickRunner {
  private connection: Connection;
  private injector: LagInjector;
  private config: SimulationConfig;
  private stats: SimulationStats;
  private priceHistory: PriceData[] = [];
  private currentSlot = 0;
  private startTime: number = 0;

  constructor(
    connection: Connection,
    injector: LagInjector,
    config: SimulationConfig
  ) {
    this.connection = connection;
    this.injector = injector;
    this.config = config;
    this.stats = {
      totalTicks: 0,
      breakerTrips: 0,
      falsePositives: 0,
      lastPrice: 0,
      lastTWAP: 0,
    };
  }

  async run(): Promise<SimulationStats> {
    console.log("Starting pure-onchain Anchor JitoSOL depeg simulation...");
    this.startTime = Date.now();
    const historicalPrices = await getHistoricalJitoPrices();
    this.priceHistory = historicalPrices;

    if (this.priceHistory.length === 0) {
      throw new Error("No historical price data available");
    }

    console.log(`Loaded ${this.priceHistory.length} historical JitoSOL price points`);

    const tickInterval = this.config.tickIntervalMs;
    const totalTicks = Math.floor((this.config.simDurationDays * 24 * 60 * 60 * 1000) / tickInterval);
    
    for (let i = 0; i < totalTicks; i++) {
      await this.tick();
      await new Promise(resolve => setTimeout(resolve, tickInterval));
    }

    const durationMs = Date.now() - this.startTime;
    console.log(`Simulation completed in ${durationMs}ms`);
    this.logStats();
    return this.stats;
  }

  private async tick(): Promise<void> {
    this.currentSlot += 1;
    this.stats.totalTicks += 1;

    const realPrice = this.getRealPriceAtCurrentSlot();
    const laggedPrice = this.injector.getCurrentPrice();

    // Simulate on-chain price injection with lag
    this.injector.injectPriceAtSlot(this.currentSlot, realPrice);

    // Check TWAP false positive using the lagged view
    const isFalsePositive = checkTWAPFalsePositive(
      this.injector.getPriceHistory(),
      this.config.twapWindowSeconds
    );

    if (isFalsePositive) {
      this.stats.falsePositives += 1;
      console.log(`[${this.currentSlot}] TWAP false positive detected at price ${realPrice.toFixed(4)}`);
    }

    // Simple drawdown circuit breaker simulation (15% drop from TWAP)
    const currentTWAP = this.calculateSimpleTWAP();
    this.stats.lastPrice = realPrice;
    this.stats.lastTWAP = currentTWAP;

    if (realPrice < currentTWAP * 0.85) {
      this.stats.breakerTrips += 1;
      console.log(`[${this.currentSlot}] CIRCUIT BREAKER TRIPPED at ${realPrice.toFixed(4)} (TWAP: ${currentTWAP.toFixed(4)})`);
    }

    if (this.stats.totalTicks % 100 === 0) {
      this.logStats();
    }
  }

  private getRealPriceAtCurrentSlot(): number {
    const index = Math.min(this.currentSlot % this.priceHistory.length, this.priceHistory.length - 1);
    return this.priceHistory[index].price;
  }

  private calculateSimpleTWAP(): number {
    if (this.priceHistory.length === 0) return 1.0;
    const windowSize = Math.min(30, this.priceHistory.length);
    const recent = this.priceHistory.slice(-windowSize);
    return recent.reduce((sum, p) => sum + p.price, 0) / recent.length;
  }

  private logStats(): void {
    const elapsedHours = ((Date.now() - this.startTime) / (1000 * 60 * 60)).toFixed(2);
    console.log(
      `[STATS] ticks:${this.stats.totalTicks} ` +
      `trips:${this.stats.breakerTrips} ` +
      `falsePos:${this.stats.falsePositives} ` +
      `price:${this.stats.lastPrice.toFixed(4)} ` +
      `twap:${this.stats.lastTWAP.toFixed(4)} ` +
      `elapsed:${elapsedHours}h`
    );
  }
}

// Main entrypoint - matches the exact call sites expected by CI
async function main() {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  
  const config: LagInjectorConfig = {
    lagSeconds: 45,
    oraclePubkey: new PublicKey("J1tore1o2p1v1o2p1v1o2p1v1o2p1v1o2p1v1o2p1v"),
    updateFrequencySlots: 8,
  };

  const injector = new LagInjector(connection, config);
  
  const simConfig: SimulationConfig = {
    lagSeconds: 45,
    twapWindowSeconds: 15,
    simDurationDays: 7,
    tickIntervalMs: 15000,
  };

  const runner = new TickRunner(connection, injector, simConfig);
  await runner.run();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Simulation failed:", err);
    process.exit(1);
  });
}

export { TickRunner, SimulationConfig, SimulationStats };
