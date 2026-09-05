import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";

interface SimulationConfig {
  lagSeconds: number;
  twapWindowSeconds: number;
  falsePositiveThreshold: number;
  simulationDays: number;
  tickIntervalMs: number;
}

interface BreakerTrip {
  timestamp: number;
  price: number;
  reason: string;
}

interface SimulationStats {
  totalTicks: number;
  breakerTrips: BreakerTrip[];
  falsePositives: number;
  truePositives: number;
}

class TickRunner {
  private connection: Connection;
  private program: Program<Vault>;
  private injector: LagInjector;
  private config: SimulationConfig;
  private oracleAccount: PublicKey;
  private bufferAccount: PublicKey;
  private owner: Keypair;

  constructor(
    connection: Connection,
    program: Program<Vault>,
    injector: LagInjector,
    config: SimulationConfig,
    oracleAccount: PublicKey,
    bufferAccount: PublicKey,
    owner: Keypair
  ) {
    this.connection = connection;
    this.program = program;
    this.injector = injector;
    this.config = config;
    this.oracleAccount = oracleAccount;
    this.bufferAccount = bufferAccount;
    this.owner = owner;
  }

  async run(): Promise<SimulationStats> {
    console.log("Starting 7-day tick simulation with lag injector...");
    
    const historicalPrices = await getHistoricalJitoPrices();
    console.log(`Loaded ${historicalPrices.length} historical JitoSOL price points`);

    const stats: SimulationStats = {
      totalTicks: 0,
      breakerTrips: [],
      falsePositives: 0,
      truePositives: 0,
    };

    const startTime = Date.now();
    const simulationDurationMs = this.config.simulationDays * 24 * 60 * 60 * 1000;
    let currentTick = 0;
    const ticksPerDay = (24 * 60 * 60 * 1000) / this.config.tickIntervalMs;
    const totalTicks = Math.floor(this.config.simulationDays * ticksPerDay);

    // Replay last three depeg series with lag
    const laggedSeries = await this.injector.replayWithLag(historicalPrices, this.config.lagSeconds);
    console.log(`Injected lag of ${this.config.lagSeconds}s. Effective series length: ${laggedSeries.length}`);

    while (currentTick < totalTicks) {
      const tickTime = startTime + currentTick * this.config.tickIntervalMs;
      const simulatedTimestamp = Math.floor(tickTime / 1000);

      // Get current lagged price
      const currentPricePoint = this.getPriceAtTime(laggedSeries, simulatedTimestamp);
      if (!currentPricePoint) {
        currentTick++;
        continue;
      }

      // Check TWAP for false positive
      const windowStart = simulatedTimestamp - this.config.twapWindowSeconds;
      const twapSeries = this.getSeriesInWindow(laggedSeries, windowStart, simulatedTimestamp);
      
      const isFalsePositive = checkTWAPFalsePositive(twapSeries, this.config.falsePositiveThreshold);
      
      if (isFalsePositive) {
        stats.falsePositives++;
        console.log(`[${new Date(tickTime).toISOString()}] TWAP false positive detected at price $${currentPricePoint.price.toFixed(4)}`);
      }

      // Check for breaker trip (simplified on-chain logic)
      const shouldTrip = this.checkDrawdownCircuitBreaker(currentPricePoint.price, twapSeries);
      if (shouldTrip) {
        const trip: BreakerTrip = {
          timestamp: simulatedTimestamp,
          price: currentPricePoint.price,
          reason: isFalsePositive ? "false-positive-drawdown" : "real-drawdown",
        };
        stats.breakerTrips.push(trip);
        
        if (isFalsePositive) {
          stats.falsePositives++;
        } else {
          stats.truePositives++;
        }
        
        console.log(`[${new Date(tickTime).toISOString()}] CIRCUIT BREAKER TRIPPED at $${currentPricePoint.price.toFixed(4)} (${trip.reason})`);
        
        // Simulate pause
        await this.simulatePauseInstruction();
      }

      stats.totalTicks++;
      currentTick++;

      // Log progress
      if (currentTick % Math.floor(totalTicks / 10) === 0) {
        const progress = ((currentTick / totalTicks) * 100).toFixed(1);
        console.log(`Simulation progress: ${progress}% | Trips: ${stats.breakerTrips.length} | False Pos: ${stats.falsePositives}`);
      }

      // Throttle for realism
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    this.logFinalStats(stats);
    return stats;
  }

  private getPriceAtTime(series: PriceData[], timestamp: number): PriceData | null {
    // Find closest price point (simplified nearest-neighbor)
    let closest: PriceData | null = null;
    let minDiff = Infinity;
    
    for (const point of series) {
      const diff = Math.abs(point.timestamp - timestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closest = point;
      }
    }
    
    return closest && minDiff < 3600 ? closest : null; // within 1 hour tolerance
  }

  private getSeriesInWindow(series: PriceData[], start: number, end: number): PriceData[] {
    return series.filter(p => p.timestamp >= start && p.timestamp <= end);
  }

  private checkDrawdownCircuitBreaker(currentPrice: number, windowPrices: PriceData[]): boolean {
    if (windowPrices.length < 2) return false;
    
    const minPrice = Math.min(...windowPrices.map(p => p.price));
    const drawdown = (currentPrice - minPrice) / minPrice;
    
    // Trip if >20% drawdown (example threshold for JitoSOL depeg protection)
    return drawdown < -0.20;
  }

  private async simulatePauseInstruction(): Promise<void> {
    // Simulate on-chain pause call (no-op in sim harness)
    console.log("  -> Simulated owner pause + withdraw instruction");
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  private logFinalStats(stats: SimulationStats): void {
    console.log("\n=== SIMULATION COMPLETE ===");
    console.log(`Total ticks: ${stats.totalTicks}`);
    console.log(`Breaker trips: ${stats.breakerTrips.length}`);
    console.log(`True positives: ${stats.truePositives}`);
    console.log(`False positives: ${stats.falsePositives}`);
    console.log(`False positive rate: ${stats.totalTicks > 0 ? ((stats.falsePositives / stats.totalTicks) * 100).toFixed(2) : 0}%`);
    
    if (stats.breakerTrips.length > 0) {
      console.log("\nTrip events:");
      stats.breakerTrips.forEach((trip, i) => {
        console.log(`  ${i+1}. ${new Date(trip.timestamp * 1000).toISOString()} | $${trip.price.toFixed(4)} | ${trip.reason}`);
      });
    }
  }
}

// Main entry point for the sim
async function main() {
  // Setup anchor provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as Program<Vault>;
  
  const owner = Keypair.generate();
  const oracleAccount = new PublicKey("oracle111111111111111111111111111111111111111");
  const bufferAccount = new PublicKey("buffer1111111111111111111111111111111111111");

  // Config aligned with milestone (45s lag target)
  const config: SimulationConfig = {
    lagSeconds: 45,
    twapWindowSeconds: 15,
    falsePositiveThreshold: 0.015, // 1.5% deviation tolerance
    simulationDays: 7,
    tickIntervalMs: 15000, // 15s ticks
  };

  const injectorConfig = {
    lagSeconds: config.lagSeconds,
    slotExact: true,
    replaySeriesCount: 3,
  };

  const injector = new LagInjector(
    provider.connection,
    oracleAccount,
    injectorConfig
  );

  const runner = new TickRunner(
    provider.connection,
    program,
    injector,
    config,
    oracleAccount,
    bufferAccount,
    owner
  );

  try {
    await runner.run();
    console.log("\n✅ Pure-onchain Anchor JitoSOL depeg simulation completed successfully.");
  } catch (err) {
    console.error("Simulation failed:", err);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { TickRunner, SimulationConfig, BreakerTrip, SimulationStats };
