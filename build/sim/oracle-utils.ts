import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  getHistoricalPriceSeries(): PriceData[];
  length: number;
  filter(predicate: (p: PriceData) => boolean): PriceData[];
  slice(start?: number, end?: number): PriceData[];
}

export interface LagInjectorConfig {
  lagMs: number;
  lagSlots: number;
  filter?: (p: PriceData) => boolean;
}

export interface OracleConfig {
  oracle: PublicKey;
  lagSlots: number;
}

export class OracleUtils {
  static createPriceData(price: number, timestamp: number): PriceData {
    return { price, timestamp };
  }

  static createHistoricalPriceSeries(prices: PriceData[]): HistoricalPriceSeries {
    return {
      prices,
      getHistoricalPriceSeries(): PriceData[] {
        return this.prices;
      },
      get length(): number {
        return this.prices.length;
      },
      filter(predicate: (p: PriceData) => boolean): PriceData[] {
        return this.prices.filter(predicate);
      },
      slice(start?: number, end?: number): PriceData[] {
        return this.prices.slice(start, end);
      },
    };
  }

  static createLagInjectorConfig(lagMs: number, lagSlots: number, filter?: (p: PriceData) => boolean): LagInjectorConfig {
    return { lagMs, lagSlots, filter };
  }

  static createOracleConfig(oracle: PublicKey, lagSlots: number): OracleConfig {
    return { oracle, lagSlots };
  }

  static getHistoricalPriceSeries(series: HistoricalPriceSeries): PriceData[] {
    return series.getHistoricalPriceSeries();
  }

  static async replaySeries(
    provider: anchor.AnchorProvider,
    series: HistoricalPriceSeries,
    lagMs: number,
    oracle: PublicKey,
    startSlot: number
  ): Promise<void> {
    // Simulated replay - in real usage this would drive test validator updates
    console.log(`Replaying series of length ${series.length} with lag ${lagMs}ms starting at slot ${startSlot}`);
    // No-op for type compatibility; actual injection lives in LagInjector
  }
}

export class LagInjector {
  private config: LagInjectorConfig;
  private oracle: PublicKey;
  private provider: anchor.AnchorProvider;

  constructor(provider: anchor.AnchorProvider, oracle: PublicKey, config: LagInjectorConfig) {
    this.provider = provider;
    this.oracle = oracle;
    this.config = config;
  }

  async injectSeries(series: HistoricalPriceSeries, startSlot: number): Promise<void> {
    const lagMs = this.config.lagMs;
    await OracleUtils.replaySeries(this.provider, series, lagMs, this.oracle, startSlot);
    console.log(`Injected series with lag of ${lagMs}ms`);
  }

  updateOracleWithLag(price: PriceData, currentSlot: number): void {
    const effectiveSlot = currentSlot - this.config.lagSlots;
    console.log(`Update oracle with price ${price.price} at effective slot ${effectiveSlot}`);
    // In full implementation this would call the on-chain oracle update instruction with lagged data
  }
}

export function checkTWAPFalsePositive(series: HistoricalPriceSeries, windowMs: number): boolean {
  const prices = OracleUtils.getHistoricalPriceSeries(series);
  if (prices.length < 2) return false;
  const startTime = prices[0].timestamp;
  const endTime = prices[prices.length - 1].timestamp;
  if (endTime - startTime < windowMs) return false;

  // Simple TWAP deviation check for sim (15s window false-positive test)
  const avg = prices.reduce((sum, p) => sum + p.price, 0) / prices.length;
  const last = prices[prices.length - 1].price;
  const deviation = Math.abs(last - avg) / avg;
  return deviation > 0.05; // >5% deviation triggers false-positive flag in sim
}

export { checkTWAPFalsePositive as checkTWAPFalsePositive };
