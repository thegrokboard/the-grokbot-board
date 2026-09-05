import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import { LagInjector, LagInjectorConfig } from "./lag-injector";
import { TWAPChecker } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";

const RPC_URL = "http://127.0.0.1:8899";
const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn");

interface SimulationConfig {
  lagSeconds: number;
  twapWindowSeconds: number;
  tickIntervalMs: number;
  totalTicks: number;
  replaySeriesLength: number;
}

const DEFAULT_CONFIG: SimulationConfig = {
  lagSeconds: 45,
  twapWindowSeconds: 15,
  tickIntervalMs: 15000,
  totalTicks: 40320, // 7 days @ 15s ticks
  replaySeriesLength: 3,
};

class TickRunner {
  private connection: Connection;
  private lagInjector: LagInjector;
  private twapChecker: TWAPChecker;
  private config: SimulationConfig;
  private currentSlot = 0;
  private breakerTrips = 0;
  private falsePositives = 0;
  private totalChecks = 0;

  constructor(config: Partial<SimulationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.connection = new Connection(RPC_URL, "confirmed");
    
    const lagConfig: LagInjectorConfig = {
      lagSeconds: this.config.lagSeconds,
      oracleProgramId: new PublicKey("oracle111111111111111111111111111111111111111"),
      priceFeedAccount: new PublicKey("price11111111111111111111111111111111111111"),
    };
    
    this.lagInjector = new LagInjector(this.connection, lagConfig);
    this.twapChecker = new TWAPChecker(this.config.twapWindowSeconds);
  }

  async run(): Promise<void> {
    console.log("=== Pure Onchain Anchor JitoSOL Depeg Protection Simulator ===");
    console.log(`Lag target: ${this.config.lagSeconds}s | TWAP window: ${this.config.twapWindowSeconds}s`);
    console.log(`Total simulation ticks: ${this.config.totalTicks} (~7 days @ 15s/tick)\n`);

    const historicalPrices: PriceData[] = await getHistoricalJitoPrices();
    const seriesToReplay = historicalPrices.slice(0, this.config.replaySeriesLength * 60); // ~3 series

    console.log(`Loaded ${historicalPrices.length} historical price points. Replaying ${this.config.replaySeriesLength} depeg series.\n`);

    for (let tick = 0; tick < this.config.totalTicks; tick++) {
      this.currentSlot += 1; // advance one slot per tick for determinism

      // Inject lagged prices into the local test validator oracle account
      await this.lagInjector.replayWithLag(seriesToReplay, this.currentSlot);

      // Run the on-chain drawdown / TWAP check (simulated via TS checker against same series)
      const pricesForCheck = seriesToReplay.slice(-this.config.twapWindowSeconds * 4); // sample rate assumption
      const isFalsePositive = this.twapChecker.checkTWAPFalsePositive(pricesForCheck);

      this.totalChecks++;
      if (isFalsePositive) {
        this.falsePositives++;
      }

      // Simulate breaker trip logic (simple threshold for demo)
      const latestPrice = pricesForCheck[pricesForCheck.length - 1];
      if (latestPrice && latestPrice.price < 0.85) {
        this.breakerTrips++;
        console.log(`[TICK ${tick}] DRAW DOWN BREACH DETECTED at price $${latestPrice.price.toFixed(4)} - circuit breaker would trip`);
      }

      if (tick % 500 === 0 && tick > 0) {
        this.logProgress(tick);
      }

      // Sleep to simulate real-time ticking
      await new Promise(resolve => setTimeout(resolve, this.config.tickIntervalMs));
    }

    this.logSummary();
  }

  private logProgress(tick: number): void {
    const progress = ((tick / this.config.totalTicks) * 100).toFixed(1);
    console.log(`[PROGRESS ${progress}%] ticks:${tick} | checks:${this.totalChecks} | trips:${this.breakerTrips} | falsePos:${this.falsePositives}`);
  }

  private logSummary(): void {
    console.log("\n=== SIMULATION COMPLETE ===");
    console.log(`Total ticks: ${this.config.totalTicks}`);
    console.log(`Price checks performed: ${this.totalChecks}`);
    console.log(`Circuit breaker trips: ${this.breakerTrips}`);
    console.log(`TWAP 15s false positives: ${this.falsePositives}`);
    console.log(`False positive rate: ${this.totalChecks > 0 ? ((this.falsePositives / this.totalChecks) * 100).toFixed(3) : 0}%`);
    console.log("\nPure on-chain Anchor vault harness simulation finished successfully.");
  }
}

// Run the simulation when executed directly
if (require.main === module) {
  const runner = new TickRunner();
  runner.run().catch((err) => {
    console.error("Simulation failed:", err);
    process.exit(1);
  });
}

export { TickRunner, SimulationConfig };
