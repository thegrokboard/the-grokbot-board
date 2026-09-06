import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  oracle: PublicKey;
  symbol: string;
}

export interface LagInjectorConfig {
  lagSlots: number;
  targetLagMs: number;
  jitoSolOracle: PublicKey;
}

export interface OracleConfig {
  jitoSolOracle: PublicKey;
  lagSlots: number;
}

export class OracleUtils {
  static createHistoricalPriceSeries(
    prices: PriceData[],
    oracle: PublicKey,
    symbol: string = "jitoSOL"
  ): HistoricalPriceSeries {
    return { prices, oracle, symbol };
  }

  static getHistoricalPriceSeries(
    series: HistoricalPriceSeries,
    startIndex: number = 0,
    count?: number
  ): PriceData[] {
    if (count === undefined) {
      return series.prices.slice(startIndex);
    }
    return series.prices.slice(startIndex, startIndex + count);
  }

  static filterSeriesAfter(
    series: HistoricalPriceSeries,
    timestamp: number
  ): HistoricalPriceSeries {
    const filtered = series.prices.filter(p => p.timestamp > timestamp);
    return {
      ...series,
      prices: filtered
    };
  }

  static async replaySeriesWithLag(
    connection: Connection,
    series: HistoricalPriceSeries,
    lagSlots: number,
    updateOracle: (price: number, slot: number) => Promise<void>
  ): Promise<void> {
    if (series.prices.length === 0) return;

    let baseSlot = 1000;
    for (let i = 0; i < series.prices.length; i++) {
      const data = series.prices[i];
      const slot = baseSlot + i;
      const laggedSlot = Math.max(baseSlot, slot - lagSlots);
      await updateOracle(data.price, laggedSlot);
      // Simulate slot advancement
      if (i % 5 === 0) baseSlot += 5;
    }
  }
}

export class LagInjector {
  private config: LagInjectorConfig;
  private series: HistoricalPriceSeries | null = null;

  constructor(config: LagInjectorConfig) {
    this.config = config;
  }

  injectSeries(series: HistoricalPriceSeries): void {
    this.series = series;
  }

  getCurrentSeries(): HistoricalPriceSeries | null {
    return this.series;
  }

  async updateOracleWithLag(
    provider: anchor.Provider,
    price: number,
    slot: number
  ): Promise<void> {
    // In sim, we just log the update; real implementation would use a mock oracle program
    console.log(`[LagInjector] Updating oracle at slot ${slot} with price ${price} (lag: ${this.config.lagSlots} slots)`);
    // TODO: integrate with test validator oracle account in full harness
  }

  async replayLastThreeSeries(
    provider: anchor.Provider,
    historicalSeries: HistoricalPriceSeries[]
  ): Promise<void> {
    if (!this.series) {
      this.series = historicalSeries[historicalSeries.length - 1] || OracleUtils.createHistoricalPriceSeries([], this.config.jitoSolOracle);
    }
    const recent = historicalSeries.slice(-3);
    for (const s of recent) {
      await OracleUtils.replaySeriesWithLag(
        (provider as any).connection,
        s,
        this.config.lagSlots,
        async (price, slot) => {
          await this.updateOracleWithLag(provider, price, slot);
        }
      );
    }
  }
}

export function createLagInjector(config: LagInjectorConfig): LagInjector {
  return new LagInjector(config);
}

export function checkTWAPFalsePositive(
  series: HistoricalPriceSeries,
  twapPeriodSlots: number = 15,
  threshold: number = 0.05
): boolean {
  if (series.prices.length < twapPeriodSlots) return false;

  const recent = series.prices.slice(-twapPeriodSlots);
  const sum = recent.reduce((acc, p) => acc + p.price, 0);
  const twap = sum / recent.length;

  const latest = recent[recent.length - 1].price;
  const deviation = Math.abs(latest - twap) / twap;

  return deviation > threshold;
}

// Legacy alias for backward compatibility with committed callers
export const getHistoricalPriceSeries = OracleUtils.getHistoricalPriceSeries;
export { OracleUtils as defaultOracleUtils };
