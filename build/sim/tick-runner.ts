import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { LagInjector, LagInjectorConfig, PriceData } from "./lag-injector";
import { getHistoricalJitoPrices, HistoricalPriceSeries } from "./oracle-utils";
import { checkTWAPFalsePositive, TWAPConfig } from "./twap-checker";

const DEFAULT_LAG_SECONDS = 45;
const DEFAULT_TWAP_WINDOW_SLOTS = 150; // ~15s at 400ms/slot
const DEFAULT_TWAP_THRESHOLD_BPS = 500; // 5%

interface SimulationConfig {
  lagSeconds?: number;
  twapConfig?: Partial<TWAPConfig>;
  replayDays?: number;
  verbose?: boolean;
}

class TickRunner {
  private connection: Connection;
  private lagInjector: LagInjector;
  private priceHistory: PriceData[] = [];
  private breakerTrips = 0;
  private falsePositives = 0;
  private config: Required<SimulationConfig>;

  constructor(connection: Connection, config: SimulationConfig = {}) {
    this.connection = connection;
    this.config = {
      lagSeconds: config.lagSeconds ?? DEFAULT_LAG_SECONDS,
      twapConfig: {
        windowSlots: config.twapConfig?.windowSlots ?? DEFAULT_TWAP_WINDOW_SLOTS,
        thresholdBps: config.twapConfig?.thresholdBps ?? DEFAULT_TWAP_THRESHOLD_BPS,
        minObservations: config.twapConfig?.minObservations ?? 30,
      },
      replayDays: config.replayDays ?? 7,
      verbose: config.verbose ?? true,
    };

    const injectorConfig: LagInjectorConfig = {
      lagSeconds: this.config.lagSeconds,
      oracleProgramId: new PublicKey("7Wj6K8s4v2v7vJ8k9L5mX7vN8pQ2rT3vY4uI6oP9qR"),
    };
    this.lagInjector = new LagInjector(this.connection, injectorConfig);
  }

  async run(): Promise<{ trips: number; falsePositives: number; totalTicks: number }> {
    console.log(`Starting 7-day JitoSOL depeg simulation with ${this.config.lagSeconds}s lag...`);

    const historicalSeries: HistoricalPriceSeries = await getHistoricalJitoPrices(this.config.replayDays);
    this.priceHistory = historicalSeries.prices;
    if (this.priceHistory.length === 0) {
      throw new Error("No historical price data available");
    }

    console.log(`Loaded ${this.priceHistory.length} historical price points for replay.`);

    let tickCount = 0;
    const startSlot = 100_000_000;
    let currentSlot = startSlot;

    for (let i = 0; i < this.priceHistory.length; i++) {
      const pricePoint = this.priceHistory[i];
      const slot = currentSlot + Math.floor(i * 2.5); // approximate slot progression

      // Inject lagged price
      await this.lagInjector.injectPriceAtSlot(
        new anchor.BN(slot),
        pricePoint.price,
        pricePoint.confidence
      );

      // Simulate on-chain tick / check
      const currentPrice = await this.lagInjector.getCurrentPrice();
      const historyForCheck = await this.lagInjector.getPriceHistory(150);

      const isFalsePositive = checkTWAPFalsePositive(
        historyForCheck,
        this.config.twapConfig as TWAPConfig
      );

      if (isFalsePositive) {
        this.falsePositives++;
        if (this.config.verbose) {
          console.log(`Tick ${tickCount} (slot ~${slot}): FALSE POSITIVE detected`);
        }
      } else if (currentPrice < 0.95) {
        this.breakerTrips++;
        if (this.config.verbose) {
          console.log(`Tick ${tickCount} (slot ~${slot}): Circuit breaker TRIPPED`);
        }
      }

      tickCount++;
      if (tickCount % 500 === 0 && this.config.verbose) {
        console.log(`Processed ${tickCount} ticks...`);
      }

      // Advance simulated time
      currentSlot += 1;
    }

    const summary = {
      trips: this.breakerTrips,
      falsePositives: this.falsePositives,
      totalTicks: tickCount,
    };

    console.log("\nSimulation complete:");
    console.log(`  Breaker trips: ${summary.trips}`);
    console.log(`  False positives: ${summary.falsePositives}`);
    console.log(`  Total ticks: ${summary.totalTicks}`);

    return summary;
  }
}

// CLI entrypoint
async function main() {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const runner = new TickRunner(connection, {
    lagSeconds: 45,
    verbose: true,
  });

  try {
    await runner.run();
    process.exit(0);
  } catch (err) {
    console.error("Simulation failed:", err);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { TickRunner, SimulationConfig };
