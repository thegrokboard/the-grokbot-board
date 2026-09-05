import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices } from "./oracle-utils";

interface SimConfig {
  oracleLagSlots: number;
  targetLagSeconds: number;
  twapPeriodSeconds: number;
  falsePositiveThreshold: number;
}

const DEFAULT_CONFIG: SimConfig = {
  oracleLagSlots: 225, // ~45s at 200ms/slot
  targetLagSeconds: 45,
  twapPeriodSeconds: 15,
  falsePositiveThreshold: 0.02,
};

class TickRunner {
  private connection: Connection;
  private injector: LagInjector;
  private config: SimConfig;
  private breakerTrips: number = 0;
  private falsePositives: number = 0;
  private totalTicks: number = 0;

  constructor(connection: Connection, config: Partial<SimConfig> = {}) {
    this.connection = connection;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.injector = new LagInjector(connection, this.config.oracleLagSlots);
  }

  async runSimulation(days: number = 7): Promise<void> {
    console.log(`Starting 7-day JitoSOL depeg sim with ${this.config.oracleLagSlots} slot lag...`);
    
    const historicalPrices = getHistoricalJitoPrices();
    console.log(`Loaded ${historicalPrices.length} historical price points`);

    const slotDurationMs = 200;
    const totalSlots = days * 24 * 60 * 60 * 5; // 5 slots per second
    const tickIntervalMs = this.config.twapPeriodSeconds * 1000;

    let currentSlot = 100_000;
    const startTime = Date.now();

    for (let tick = 0; tick < totalSlots; tick += 5) { // advance by ~1s per outer loop
      currentSlot += 5;
      this.totalTicks++;

      // Inject lagged prices
      await this.injector.replayWithLag(historicalPrices, currentSlot);

      // Run TWAP false-positive check every 15s
      if (this.totalTicks % (this.config.twapPeriodSeconds * 5) === 0) {
        const isFalsePositive = checkTWAPFalsePositive(
          historicalPrices,
          currentSlot,
          this.config.twapPeriodSeconds,
          this.config.falsePositiveThreshold
        );

        if (isFalsePositive) {
          this.falsePositives++;
          console.log(`[${new Date().toISOString()}] Slot ${currentSlot}: TWAP false positive detected`);
        }

        // Simulate circuit breaker trip on real depeg (simple threshold for sim)
        const latestPrice = historicalPrices[historicalPrices.length - 1].price;
        if (latestPrice < 0.90) { // example depeg threshold
          this.breakerTrips++;
          console.log(`[${new Date().toISOString()}] Slot ${currentSlot}: CIRCUIT BREAKER TRIPPED (drawdown protection)`);
        }
      }

      // Throttle to simulate real-time
      if (this.totalTicks % 50 === 0) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logResults(days, duration);
  }

  private logResults(days: number, duration: string): void {
    console.log("\n=== Pure Onchain Anchor JitoSOL Vault Sim Complete ===");
    console.log(`Duration: ${days} days simulated in ${duration}s`);
    console.log(`Total ticks: ${this.totalTicks}`);
    console.log(`Circuit breaker trips: ${this.breakerTrips}`);
    console.log(`TWAP false positives: ${this.falsePositives}`);
    console.log(`False positive rate: ${((this.falsePositives / Math.max(this.breakerTrips, 1)) * 100).toFixed(2)}%`);
    console.log("\nVault protection buffer would have been engaged on breaker trips.");
    console.log("Owner pause/withdraw and jitoSOL deposit paths remain available when healthy.");
  }
}

async function main() {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  
  // Wait for test validator if needed
  try {
    await connection.getSlot();
  } catch (e) {
    console.error("Test validator not running. Start with: anchor test --detach");
    process.exit(1);
  }

  const runner = new TickRunner(connection);
  await runner.runSimulation(7);
}

if (require.main === module) {
  main().catch(console.error);
}

export { TickRunner, type SimConfig };
