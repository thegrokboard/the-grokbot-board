import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";

interface SimulationConfig {
  oracleLagSlots: number;
  twapPeriodSlots: number;
  falsePositiveThreshold: number;
  tickIntervalMs: number;
  totalTicks: number;
  initialPrice: number;
}

interface BreakerTrip {
  tick: number;
  price: number;
  twap: number;
  isFalsePositive: boolean;
}

class TickRunner {
  private connection: Connection;
  private lagInjector: LagInjector;
  private config: SimulationConfig;
  private breakerTrips: BreakerTrip[] = [];
  private currentSlot = 0;
  private priceHistory: PriceData[] = [];

  constructor(config: SimulationConfig) {
    this.config = config;
    this.connection = new Connection("http://127.0.0.1:8899", "confirmed");
    this.lagInjector = new LagInjector(this.connection, config.oracleLagSlots);
  }

  async init(): Promise<void> {
    const historicalPrices = await getHistoricalJitoPrices();
    this.priceHistory = historicalPrices;
    console.log(`Loaded ${this.priceHistory.length} historical JitoSOL price points`);
  }

  async run(): Promise<void> {
    await this.init();
    console.log("Starting 7-day tick simulation (replay with lag)...");
    
    const prices = [...this.priceHistory];
    let priceIndex = 0;

    for (let tick = 0; tick < this.config.totalTicks; tick++) {
      this.currentSlot += 1;

      // Replay next price (cycle if exhausted)
      let currentPrice: number;
      if (priceIndex < prices.length) {
        currentPrice = prices[priceIndex].price;
        priceIndex = (priceIndex + 1) % prices.length;
      } else {
        currentPrice = this.config.initialPrice;
      }

      // Inject lagged price via oracle account simulation
      await this.lagInjector.replayLaggedPrice(currentPrice, this.currentSlot);

      // Every tick, check the TWAP with configured period
      const twapResult = checkTWAPFalsePositive(
        this.priceHistory,
        this.currentSlot,
        {
          periodSlots: this.config.twapPeriodSlots,
          threshold: this.config.falsePositiveThreshold
        }
      );

      const isFalsePositive = typeof twapResult === "boolean" ? twapResult : false;
      const twapValue = typeof twapResult === "number" ? twapResult : 0;

      if (twapResult !== false && typeof twapResult === "number" && Math.abs(twapResult - currentPrice) > this.config.falsePositiveThreshold) {
        this.breakerTrips.push({
          tick: this.currentSlot,
          price: currentPrice,
          twap: twapValue,
          isFalsePositive: isFalsePositive
        });
        console.log(`[TICK ${this.currentSlot}] Circuit breaker TRIPPED | Price: ${currentPrice.toFixed(4)} | TWAP: ${twapValue.toFixed(4)}`);
      }

      if (tick % 100 === 0) {
        console.log(`Processed tick ${tick} (slot ~${this.currentSlot})`);
      }

      // Simulate real-time delay
      await new Promise(resolve => setTimeout(resolve, this.config.tickIntervalMs));
    }

    this.logResults();
  }

  private logResults(): void {
    console.log("\n=== Simulation Complete ===");
    console.log(`Total ticks: ${this.config.totalTicks}`);
    console.log(`Breaker trips: ${this.breakerTrips.length}`);
    console.log(`False positives: ${this.breakerTrips.filter(t => t.isFalsePositive).length}`);
    
    if (this.breakerTrips.length > 0) {
      console.log("\nBreaker trip details:");
      this.breakerTrips.forEach((trip, i) => {
        console.log(`  ${i+1}. Slot ${trip.tick} | Price ${trip.price.toFixed(4)} | TWAP ${trip.twap.toFixed(4)} | FalsePositive: ${trip.isFalsePositive}`);
      });
    }
  }
}

// Default configuration tuned for JitoSOL depeg replay (target 45s lag, ~15s TWAP window)
const defaultConfig: SimulationConfig = {
  oracleLagSlots: 90,          // ~45s at 2 slots/sec
  twapPeriodSlots: 30,         // ~15s TWAP
  falsePositiveThreshold: 0.03, // 3% deviation triggers breaker
  tickIntervalMs: 50,
  totalTicks: 120960,          // 7 days @ 2 slots/sec = ~1.2M slots, downsampled
  initialPrice: 0.92
};

async function main() {
  const runner = new TickRunner(defaultConfig);
  await runner.run().catch(console.error);
}

if (require.main === module) {
  main();
}

export { TickRunner, SimulationConfig, BreakerTrip };
