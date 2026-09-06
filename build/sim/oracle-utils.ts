import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { BN } from "bn.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  asset: string;
  startSlot: number;
}

export interface LagInjectorConfig {
  lagMs: number;
  updateIntervalMs: number;
  oraclePubkey: PublicKey;
  asset: string;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  asset: string;
}

export class OracleUtils {
  static createHistoricalPriceSeries(
    prices: PriceData[],
    asset: string = "jitoSOL",
    startSlot: number = 0
  ): HistoricalPriceSeries {
    return {
      prices,
      asset,
      startSlot,
    };
  }

  static createLagInjectorConfig(
    lagMs: number,
    updateIntervalMs: number,
    oraclePubkey: PublicKey,
    asset: string = "jitoSOL"
  ): LagInjectorConfig {
    return {
      lagMs,
      updateIntervalMs,
      oraclePubkey,
      asset,
    };
  }

  static createOracleConfig(
    oraclePubkey: PublicKey,
    asset: string = "jitoSOL"
  ): OracleConfig {
    return {
      oraclePubkey,
      asset,
    };
  }

  static getHistoricalPriceSeries(
    series: HistoricalPriceSeries,
    filter?: (p: PriceData) => boolean
  ): PriceData[] {
    if (!filter) return series.prices;
    return series.prices.filter(filter);
  }
}

export class LagInjector {
  private config: LagInjectorConfig;
  private connection: Connection;
  private program: any;
  private injected: Map<number, PriceData> = new Map();

  constructor(
    config: LagInjectorConfig,
    connection: Connection,
    program: any
  ) {
    this.config = config;
    this.connection = connection;
    this.program = program;
  }

  async injectSeries(series: HistoricalPriceSeries): Promise<void> {
    for (const price of series.prices) {
      const laggedTs = price.timestamp + Math.floor(this.config.lagMs / 1000);
      this.injected.set(laggedTs, price);
    }
  }

  getCurrentPriceWithLag(currentSlot: number): PriceData | null {
    let best: PriceData | null = null;
    let bestTs = -Infinity;
    const lagSeconds = Math.floor(this.config.lagMs / 1000);

    for (const [ts, price] of this.injected.entries()) {
      if (ts <= currentSlot - lagSeconds && ts > bestTs) {
        best = price;
        bestTs = ts;
      }
    }
    return best;
  }

  async updateOracleWithLag(
    currentSlot: number,
    payer: Keypair
  ): Promise<void> {
    const price = this.getCurrentPriceWithLag(currentSlot);
    if (!price) return;

    // Simulate on-chain oracle update (in real sim this would call the program)
    console.log(`[LagInjector] Updating oracle at slot ${currentSlot} with price ${price.price} (lagged)`);
    // In a full implementation this would invoke the program's update instruction
  }
}

export class TWAPCalculator {
  static calculateTWAP(
    series: HistoricalPriceSeries,
    windowSeconds: number = 15
  ): number {
    if (series.prices.length === 0) return 0;
    const now = Math.max(...series.prices.map(p => p.timestamp));
    const cutoff = now - windowSeconds;
    const windowPrices = series.prices.filter(p => p.timestamp >= cutoff);
    if (windowPrices.length === 0) return series.prices[series.prices.length - 1].price;
    const sum = windowPrices.reduce((acc, p) => acc + p.price, 0);
    return sum / windowPrices.length;
  }
}

// Named export for compatibility with previous imports
export const checkTWAPFalsePositive = TWAPCalculator.calculateTWAP;

// Re-export for convenience
export { OracleUtils as defaultOracleUtils };
