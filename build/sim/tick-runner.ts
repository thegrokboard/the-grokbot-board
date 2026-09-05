import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { OracleLagInjector, LagInjectorConfig, PriceData } from "./lag-injector";
import { OracleLagInjectorImpl } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalPriceSeries } from "./oracle-utils";

interface TickRunnerConfig {
  lagSeconds: number;
  twapWindowSeconds: number;
  falsePositiveThreshold: number;
  basePrice: number;
  jitoSolMint: string;
  owner: Keypair;
  payer: Keypair;
}

class TickRunner {
  private connection: Connection;
  private injector: OracleLagInjector;
  private config: TickRunnerConfig;
  private vaultProgram: any; // Anchor program placeholder
  private currentSlot: number = 0;
  private priceHistory: PriceData[] = [];
  private breakerTrips: number = 0;
  private falsePositives: number = 0;
  private lastTripSlot: number = 0;

  constructor(
    connection: Connection,
    injector: OracleLagInjector,
    config: TickRunnerConfig,
    vaultProgram: any
  ) {
    this.connection = connection;
    this.injector = injector;
    this.config = config;
    this.vaultProgram = vaultProgram;
  }

  async runSimulation(days: number = 7): Promise<void> {
    const totalSlots = days * 24 * 60 * 60 * 2; // ~2 slots per second
    const series = getHistoricalPriceSeries(this.config.basePrice);
    let seriesIndex = 0;

    console.log(`Starting 7-day JitoSOL depeg simulation with ${this.config.lagSeconds}s oracle lag...`);

    for (let slot = 0; slot < totalSlots; slot += 1) {
      this.currentSlot = slot;

      // Advance simulated time
      const timestamp = Math.floor(Date.now() / 1000) + Math.floor(slot / 2);

      // Inject lagged price every slot
      if (seriesIndex < series.length) {
        const raw = series[seriesIndex];
        const priceData: PriceData = {
          price: raw.price,
          confidence: raw.confidence,
          timestamp: timestamp
        };

        await this.injector.injectPriceAtSlot(priceData, slot);
        this.priceHistory.push(priceData);
        seriesIndex++;
      }

      // Run TWAP check every 15 seconds (~30 slots)
      if (slot % 30 === 0 && this.priceHistory.length > 0) {
        const isFalsePositive = checkTWAPFalsePositive(
          this.priceHistory,
          this.config.twapWindowSeconds,
          this.config.falsePositiveThreshold
        );

        if (isFalsePositive) {
          this.falsePositives++;
          console.log(`Slot ${slot}: TWAP false-positive detected`);
        }
      }

      // Simulate drawdown circuit-breaker check (every 5s)
      if (slot % 10 === 0 && this.priceHistory.length > 10) {
        const recentPrices = this.priceHistory.slice(-10);
        const currentPrice = recentPrices[recentPrices.length - 1].price;
        const avg = recentPrices.reduce((sum, p) => sum + p.price, 0) / recentPrices.length;

        if (currentPrice < avg * 0.85 && slot - this.lastTripSlot > 60) {
          this.breakerTrips++;
          this.lastTripSlot = slot;
          console.log(`Slot ${slot}: Circuit breaker TRIPPED (drawdown detected)`);
          // In real harness this would call the on-chain drawdown instruction
        }
      }

      // Simulate owner pause/withdraw check every 60s
      if (slot % 120 === 0 && this.breakerTrips > 0) {
        console.log(`Slot ${slot}: Owner pause+withdraw check (simulated)`);
      }

      // Log progress every simulated day
      if (slot % (24 * 60 * 60 * 2) === 0) {
        const day = Math.floor(slot / (24 * 60 * 60 * 2));
        console.log(`Day ${day}: Trips=${this.breakerTrips}, FalsePos=${this.falsePositives}`);
      }
    }

    console.log("\n=== Simulation Complete ===");
    console.log(`Breaker trips: ${this.breakerTrips}`);
    console.log(`False positives: ${this.falsePositives}`);
    console.log(`False positive rate: ${((this.falsePositives / (this.breakerTrips || 1)) * 100).toFixed(1)}%`);
  }
}

async function main() {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");

  // Fund payer for test validator
  const payer = Keypair.generate();
  const airdropSig = await connection.requestAirdrop(payer.publicKey, 10 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdropSig);

  const config: TickRunnerConfig = {
    lagSeconds: 45,
    twapWindowSeconds: 15,
    falsePositiveThreshold: 0.02,
    basePrice: 1.0,
    jitoSolMint: "J1toso1uCk3RLmjorhTtr2xiyxmTdN2zL6t1E3z4j6Y", // placeholder
    owner: Keypair.generate(),
    payer: payer
  };

  const lagConfig: LagInjectorConfig = {
    lagSeconds: config.lagSeconds,
    jitoSolMint: config.jitoSolMint
  };

  const injector = new OracleLagInjectorImpl(connection, lagConfig);
  const vaultProgram = {}; // Placeholder for Anchor program in full harness

  const runner = new TickRunner(connection, injector, config, vaultProgram);
  await runner.runSimulation(7);
}

if (require.main === module) {
  main().catch(console.error);
}

export { TickRunner, TickRunnerConfig };
