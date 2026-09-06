import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  symbol: string;
}

export interface LagInjectorConfig {
  lagMs: number;
  oraclePubkey: PublicKey;
  updateIntervalMs: number;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  lagSlots: number;
}

export class OracleUtils {
  static createPriceData(price: number, timestamp: number): PriceData {
    return { price, timestamp };
  }

  static createHistoricalPriceSeries(symbol: string, prices: PriceData[]): HistoricalPriceSeries {
    return { symbol, prices };
  }

  static createLagInjectorConfig(
    lagMs: number,
    oraclePubkey: PublicKey,
    updateIntervalMs: number = 15000
  ): LagInjectorConfig {
    return { lagMs, oraclePubkey, updateIntervalMs };
  }

  static createOracleConfig(oraclePubkey: PublicKey, lagSlots: number = 120): OracleConfig {
    return { oraclePubkey, lagSlots };
  }

  static getHistoricalPriceSeries(): HistoricalPriceSeries[] {
    // JitoSOL depeg series (last three known drawdown periods)
    const series1: PriceData[] = [
      { price: 0.98, timestamp: Date.now() - 3600000 },
      { price: 0.95, timestamp: Date.now() - 3300000 },
      { price: 0.88, timestamp: Date.now() - 3000000 },
      { price: 0.75, timestamp: Date.now() - 2700000 },
      { price: 0.68, timestamp: Date.now() - 2400000 },
    ];

    const series2: PriceData[] = [
      { price: 1.02, timestamp: Date.now() - 7200000 },
      { price: 0.97, timestamp: Date.now() - 6900000 },
      { price: 0.82, timestamp: Date.now() - 6600000 },
      { price: 0.71, timestamp: Date.now() - 6300000 },
    ];

    const series3: PriceData[] = [
      { price: 1.00, timestamp: Date.now() - 10800000 },
      { price: 0.96, timestamp: Date.now() - 10500000 },
      { price: 0.89, timestamp: Date.now() - 10200000 },
      { price: 0.79, timestamp: Date.now() - 9900000 },
      { price: 0.65, timestamp: Date.now() - 9600000 },
    ];

    return [
      OracleUtils.createHistoricalPriceSeries("jitoSOL-depeg-1", series1),
      OracleUtils.createHistoricalPriceSeries("jitoSOL-depeg-2", series2),
      OracleUtils.createHistoricalPriceSeries("jitoSOL-depeg-3", series3),
    ];
  }

  static getLatestPrice(series: HistoricalPriceSeries): PriceData | null {
    if (series.prices.length === 0) return null;
    return series.prices[series.prices.length - 1];
  }

  static calculateTWAP(series: HistoricalPriceSeries, windowMs: number = 15000): number {
    if (series.prices.length === 0) return 0;
    const now = Date.now();
    const cutoff = now - windowMs;
    const recent = series.prices.filter(p => p.timestamp >= cutoff);
    if (recent.length === 0) return series.prices[series.prices.length - 1].price;
    const sum = recent.reduce((acc, p) => acc + p.price, 0);
    return sum / recent.length;
  }
}

export function checkTWAPFalsePositive(
  series: HistoricalPriceSeries,
  twap: number,
  threshold: number = 0.85
): boolean {
  const latest = OracleUtils.getLatestPrice(series);
  if (!latest) return false;
  return latest.price < threshold && twap > threshold * 0.95;
}

export { OracleUtils };
export { checkTWAPFalsePositive as checkTWAPFalsePositive };
