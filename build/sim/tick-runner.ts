import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";

interface LagInjectorConfig {
  lagSlots: number;
  oraclePubkey: PublicKey;
}

interface TWAPConfig {
  windowSlots: number;
  thresholdBps: number;
}

interface SimulationResult {
  breakerTrips: number;
  falsePositives: number;
  totalTicks: number;
}

class TickRunner {
  private connection: Connection;
  private lagInjector: LagInjector;
  private series: PriceData[] = [];
  private results: SimulationResult = { breakerTrips: 0, falsePositives: 0, totalTicks: 0 };

  constructor(rpcUrl: string = "http://127.0.0.1:8899") {
    this.connection = new Connection(rpcUrl, "confirmed");
    const config: LagInjectorConfig = {
      lagSlots: 225, // ~45s at 200ms/slot target
      oraclePubkey: new PublicKey("J1tQJ5v4x2v2v2v2v2v2v2v2v2v2v2v2v2v2v2v2v"), // placeholder for sim
    };
    this.lagInjector = new LagInjector(this.connection, config);
  }

  async loadSeries(): Promise<void> {
    this.series = await getHistoricalJitoPrices();
    console.log(`Loaded ${this.series.length} historical JitoSOL price points`);
  }

  async runSimulation(days: number = 7): Promise<SimulationResult> {
    if (this.series.length === 0) {
      await this.loadSeries();
    }

    const ticksPerDay = 24 * 60 * 4; // 15s ticks
    const totalTicks = days * ticksPerDay;
    this.results.totalTicks = totalTicks;

    console.log(`Running ${totalTicks} ticks (${days} days) with 15s TWAP checks...`);

    for (let tick = 0; tick < totalTicks; tick++) {
      const lagged = this.lagInjector.getLaggedPrices(this.series, tick);
      
      if (lagged.length < 10) continue;

      const twapConfig: TWAPConfig = {
        windowSlots: 60, // 15s * 4
        thresholdBps: 500, // 5% drawdown
      };

      const isFalsePositive = checkTWAPFalsePositive(lagged, twapConfig);
      
      if (this.detectBreakerTrip(lagged)) {
        this.results.breakerTrips++;
        console.log(`[TICK ${tick}] DRAW DOWN CIRCUIT BREAKER TRIPPED`);
      } else if (isFalsePositive) {
        this.results.falsePositives++;
        console.log(`[TICK ${tick}] TWAP false positive detected`);
      }

      if (tick % 100 === 0) {
        console.log(`Progress: ${Math.round((tick / totalTicks) * 100)}% | Trips: ${this.results.breakerTrips} | False+: ${this.results.falsePositives}`);
      }
    }

    this.logResults();
    return this.results;
  }

  private detectBreakerTrip(prices: PriceData[]): boolean {
    if (prices.length < 2) return false;
    const latest = prices[prices.length - 1].price;
    const oldestInWindow = prices[prices.length - 8].price; // rough 2min window
    const drawdown = (oldestInWindow - latest) / oldestInWindow;
    return drawdown > 0.07; // 7% drawdown example threshold
  }

  private logResults(): void {
    console.log("\n=== 7-DAY SIMULATION COMPLETE ===");
    console.log(`Total ticks: ${this.results.totalTicks}`);
    console.log(`Circuit breaker trips: ${this.results.breakerTrips}`);
    console.log(`TWAP false positives: ${this.results.falsePositives}`);
    console.log(`False positive rate: ${((this.results.falsePositives / this.results.totalTicks) * 100).toFixed(3)}%`);
  }
}

// CLI entrypoint
async function main() {
  const runner = new TickRunner();
  await runner.runSimulation(7);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Simulation failed:", err);
    process.exit(1);
  });
}

export { TickRunner, SimulationResult };
