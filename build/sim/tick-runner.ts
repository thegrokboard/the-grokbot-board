import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";

interface TWAPConfig {
  windowSlots: number;
  thresholdBps: number;
}

interface SimulationResult {
  breakerTrips: number;
  falsePositives: number;
  totalTicks: number;
  logs: string[];
}

export class TickRunner {
  private connection: Connection;
  private lagInjector: LagInjector;
  private twapConfig: TWAPConfig;
  private vaultProgramId: PublicKey;
  private logs: string[] = [];
  private breakerTrips = 0;
  private falsePositives = 0;

  constructor(
    connection: Connection,
    lagInjector: LagInjector,
    twapConfig: TWAPConfig,
    vaultProgramId: PublicKey
  ) {
    this.connection = connection;
    this.lagInjector = lagInjector;
    this.twapConfig = twapConfig;
    this.vaultProgramId = vaultProgramId;
  }

  private log(message: string): void {
    const ts = new Date().toISOString();
    this.logs.push(`[${ts}] ${message}`);
    console.log(`[${ts}] ${message}`);
  }

  async run7DaySimulation(): Promise<SimulationResult> {
    this.log("Starting 7-day JitoSOL depeg simulation with onchain vault harness");
    
    const historicalPrices: PriceData[] = getHistoricalJitoPrices();
    this.log(`Loaded ${historicalPrices.length} historical price points`);

    // Replay the series with configured oracle lag (target ~45s)
    await this.lagInjector.replay(historicalPrices);
    this.log(`Replayed series with lag injector (target lag: 45 slots)`);

    const tickIntervalSlots = 15; // 15s TWAP check interval
    const totalTicks = Math.floor(historicalPrices.length / tickIntervalSlots);
    this.log(`Running ${totalTicks} ticks over replayed data`);

    for (let tick = 0; tick < totalTicks; tick++) {
      const currentSlot = tick * tickIntervalSlots;
      const currentPrice = this.lagInjector.getPriceAt(currentSlot);
      
      if (!currentPrice) {
        this.log(`Tick ${tick}: no price available at slot ${currentSlot}`);
        continue;
      }

      const isFalsePositive = checkTWAPFalsePositive(
        historicalPrices,
        currentSlot,
        this.twapConfig
      );

      const shouldTrip = !isFalsePositive && currentPrice.price < 0.95; // example drawdown threshold

      if (shouldTrip) {
        this.breakerTrips++;
        this.log(`Tick ${tick} (slot ${currentSlot}): CIRCUIT BREAKER TRIPPED at price $${currentPrice.price}`);
      } else if (isFalsePositive) {
        this.falsePositives++;
        this.log(`Tick ${tick} (slot ${currentSlot}): false positive detected (price $${currentPrice.price})`);
      } else if (currentPrice.price < 0.97) {
        this.log(`Tick ${tick} (slot ${currentSlot}): drawdown observed $${currentPrice.price} (no trip)`);
      }
    }

    this.log(`Simulation complete. Breaker trips: ${this.breakerTrips}, False positives: ${this.falsePositives}`);
    
    return {
      breakerTrips: this.breakerTrips,
      falsePositives: this.falsePositives,
      totalTicks,
      logs: this.logs
    };
  }

  getLogs(): string[] {
    return this.logs;
  }
}

// CLI entrypoint for the 7-day tick runner
async function main() {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  
  // Minimal vault program ID for test validator sim
  const vaultProgramId = new PublicKey("VAULt9T2L7vJ4J9p9v9v9v9v9v9v9v9v9v9v9v9v");

  const lagInjector = new LagInjector(connection, 45); // target 45-slot lag
  
  const twapConfig: TWAPConfig = {
    windowSlots: 150,   // ~1 minute TWAP window
    thresholdBps: 500   // 5% drawdown threshold
  };

  const runner = new TickRunner(connection, lagInjector, twapConfig, vaultProgramId);
  
  try {
    const result = await runner.run7DaySimulation();
    console.log("\n=== SIMULATION SUMMARY ===");
    console.log(`Breaker trips: ${result.breakerTrips}`);
    console.log(`False positives: ${result.falsePositives}`);
    console.log(`Total ticks: ${result.totalTicks}`);
  } catch (err) {
    console.error("Simulation failed:", err);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
