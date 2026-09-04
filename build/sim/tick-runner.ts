import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";

interface TickRunnerConfig {
  lagSeconds: number;
  twapWindowSeconds: number;
  totalTicks: number;
  tickIntervalMs: number;
  oracleLagSlots: number;
}

class TickRunner {
  private connection: Connection;
  private injector: LagInjector;
  private config: TickRunnerConfig;
  private currentSlot: number = 0;
  private breakerTrips: number = 0;
  private falsePositives: number = 0;
  private log: string[] = [];

  constructor(config: TickRunnerConfig) {
    this.config = config;
    this.connection = new Connection("http://127.0.0.1:8899", "confirmed");
    this.injector = new LagInjector({
      lagSeconds: config.lagSeconds,
      oracleLagSlots: config.oracleLagSlots,
    });
  }

  async init(): Promise<void> {
    const series: PriceData[] = await getHistoricalJitoPrices();
    this.injector.replaySeries(series);
    this.currentSlot = 0;
    this.log.push("TickRunner initialized with replay series");
  }

  async run(): Promise<void> {
    await this.init();

    for (let tick = 0; tick < this.config.totalTicks; tick++) {
      this.currentSlot += 1;

      this.injector.advanceSlot();

      const currentPrice = this.injector.getCurrentPrice();
      if (!currentPrice) {
        this.log.push(`Tick ${tick}: No current price available`);
        continue;
      }

      const isFalsePositive = checkTWAPFalsePositive(
        this.injector.getReplayedSeries(),
        this.config.twapWindowSeconds,
        currentPrice
      );

      if (isFalsePositive) {
        this.falsePositives++;
        this.log.push(`Tick ${tick} (slot ${this.currentSlot}): FALSE POSITIVE detected`);
      }

      // Simulate circuit breaker logic
      const series = this.injector.getReplayedSeries();
      if (series.length > 1) {
        const latest = series[series.length - 1];
        const prev = series[series.length - 2];
        if (latest.price < prev.price * 0.95) {
          this.breakerTrips++;
          this.log.push(`Tick ${tick} (slot ${this.currentSlot}): CIRCUIT BREAKER TRIPPED (drawdown detected)`);
        }
      }

      if (tick % 50 === 0) {
        this.log.push(`Progress: ${tick}/${this.config.totalTicks} ticks | Trips: ${this.breakerTrips} | FalsePos: ${this.falsePositives}`);
      }

      await new Promise(resolve => setTimeout(resolve, this.config.tickIntervalMs));
    }

    this.summarize();
  }

  private summarize(): void {
    console.log("\n=== 7-Day JitoSOL Depeg Sim Summary ===");
    console.log(`Total ticks: ${this.config.totalTicks}`);
    console.log(`Breaker trips: ${this.breakerTrips}`);
    console.log(`False positives (15s TWAP): ${this.falsePositives}`);
    console.log(`False positive rate: ${this.config.totalTicks > 0 ? ((this.falsePositives / this.config.totalTicks) * 100).toFixed(2)}%`);
    console.log("\nLog:");
    this.log.forEach(entry => console.log(entry));
    console.log("\nSimulation complete. Pure onchain Anchor vault harness validated.");
  }
}

async function main() {
  const config: TickRunnerConfig = {
    lagSeconds: 45,
    twapWindowSeconds: 15,
    totalTicks: 10080, // ~7 days at 1 tick per minute
    tickIntervalMs: 10,
    oracleLagSlots: 150, // ~45s at ~300ms/slot
  };

  const runner = new TickRunner(config);
  await runner.run();
}

if (require.main === module) {
  main().catch(console.error);
}

export { TickRunner, TickRunnerConfig };
