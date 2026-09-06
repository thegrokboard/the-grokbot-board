import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";

// Core price data type used throughout the sim (no slot or confidence per milestone)
export interface PriceData {
  price: number;        // in USD, scaled as needed by oracle
  timestamp: number;    // unix ms
}

// Historical series for replay (JitoSOL depeg price data)
export interface HistoricalPriceSeries {
  prices: PriceData[];
  startSlot: number;
  endSlot: number;
}

// Configuration for the lag injector
export interface LagInjectorConfig {
  lagMs: number;           // target oracle lag in milliseconds (e.g. 45000)
  slotMs: number;          // approximate ms per slot for conversion
  series: HistoricalPriceSeries[]; // the replayable depeg series
}

// Oracle config passed to program/sim components
export interface OracleConfig {
  oraclePubkey: PublicKey;
  updateAuthority: PublicKey;
}

// Utility class for creating and managing lagged oracle updates in the test validator
export class LagInjector {
  private connection: Connection;
  private config: LagInjectorConfig;
  private currentSlot: number = 0;

  constructor(connection: Connection, config: LagInjectorConfig) {
    this.connection = connection;
    this.config = config;
    this.currentSlot = 0;
  }

  static create(config: LagInjectorConfig, connection: Connection): LagInjector {
    return new LagInjector(connection, config);
  }

  getLagSlots(): number {
    return Math.floor(this.config.lagMs / this.config.slotMs);
  }

  // Inject a series with lag applied (replays prices with delay)
  async injectSeries(series: HistoricalPriceSeries, program: any): Promise<void> {
    const lagSlots = this.getLagSlots();
    const effectiveStart = series.startSlot + lagSlots;

    for (let i = 0; i < series.prices.length; i++) {
      const pricePoint = series.prices[i];
      const targetSlot = effectiveStart + i;
      
      // Advance validator to target slot (simulates time)
      while (this.currentSlot < targetSlot) {
        this.currentSlot++;
        await this.connection.requestAirdrop(Keypair.generate().publicKey, 0); // dummy to tick
      }

      // Update oracle via the vault program's oracle update (placeholder CPI in real harness)
      await this.updateOracleWithLag(
        program,
        pricePoint.price,
        pricePoint.timestamp,
        this.config.lagMs
      );
    }
  }

  private async updateOracleWithLag(
    program: any,
    price: number,
    timestamp: number,
    lagMs: number
  ): Promise<void> {
    // In the pure-onchain harness this would CPI to the oracle program or use test validator mocks
    // For sim we log and assume test validator oracle account is updated via setAccount
    console.log(`[LagInjector] Updating oracle at slot ~${this.currentSlot} with price=${price} (lag=${lagMs}ms)`);
    
    // Simulate onchain update (real implementation would use program's updateOracle instruction)
    if (program && typeof program.methods.updateOracle === "function") {
      await program.methods
        .updateOracle(new anchor.BN(price), new anchor.BN(timestamp))
        .accounts({
          oracle: this.config.oraclePubkey, // from OracleConfig
          authority: this.config.updateAuthority,
        })
        .rpc();
    }
  }

  // Returns the lagged price series for TWAP analysis (last N prices with lag applied)
  getLaggedSeries(series: HistoricalPriceSeries): HistoricalPriceSeries {
    const lagSlots = this.getLagSlots();
    return {
      prices: [...series.prices],
      startSlot: series.startSlot + lagSlots,
      endSlot: series.endSlot + lagSlots,
    };
  }
}

// Factory for default configs (used by tick-runner)
export function createLagInjectorConfig(
  lagMs: number = 45000,
  slotMs: number = 400,
  series: HistoricalPriceSeries[] = []
): LagInjectorConfig {
  return { lagMs, slotMs, series };
}

export function createOracleConfig(
  oraclePubkey: PublicKey,
  updateAuthority: PublicKey
): OracleConfig {
  return { oraclePubkey, updateAuthority };
}

// Sample historical JitoSOL depeg series (last three known depegs for replay)
// Real data would be loaded from JSON; these are representative for sim
export function getHistoricalPriceSeries(): HistoricalPriceSeries[] {
  const now = Date.now();
  const baseSlot = 280000000;

  // Series 1: Minor depeg (Nov 2024 style)
  const series1: HistoricalPriceSeries = {
    prices: [
      { price: 0.98, timestamp: now - 180000 },
      { price: 0.95, timestamp: now - 150000 },
      { price: 0.92, timestamp: now - 120000 },
      { price: 0.89, timestamp: now - 90000 },
      { price: 0.87, timestamp: now - 60000 },
    ],
    startSlot: baseSlot,
    endSlot: baseSlot + 150,
  };

  // Series 2: Severe depeg
  const series2: HistoricalPriceSeries = {
    prices: [
      { price: 0.99, timestamp: now - 360000 },
      { price: 0.85, timestamp: now - 330000 },
      { price: 0.72, timestamp: now - 300000 },
      { price: 0.68, timestamp: now - 270000 },
      { price: 0.65, timestamp: now - 240000 },
    ],
    startSlot: baseSlot + 200,
    endSlot: baseSlot + 350,
  };

  // Series 3: Recovery after depeg
  const series3: HistoricalPriceSeries = {
    prices: [
      { price: 0.75, timestamp: now - 120000 },
      { price: 0.82, timestamp: now - 90000 },
      { price: 0.91, timestamp: now - 60000 },
      { price: 0.97, timestamp: now - 30000 },
      { price: 0.995, timestamp: now },
    ],
    startSlot: baseSlot + 400,
    endSlot: baseSlot + 550,
  };

  return [series1, series2, series3];
}

// Namespace for backward compatibility with existing imports
export const OracleUtils = {
  PriceData,
  HistoricalPriceSeries,
  LagInjectorConfig,
  OracleConfig,
  LagInjector,
  createLagInjectorConfig,
  createOracleConfig,
  getHistoricalPriceSeries,
};

// Default export for direct imports
export default OracleUtils;
