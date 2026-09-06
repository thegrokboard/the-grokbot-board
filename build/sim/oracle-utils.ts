import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  startSlot: number;
  oraclePubkey: PublicKey;
}

export interface LagInjectorConfig {
  lagMs: number;
  lagSlots: number;
  replaySpeed: number;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  updateInterval: number;
}

export interface OracleUtils {
  createLagInjectorConfig(lagMs: number, lagSlots: number, replaySpeed?: number): LagInjectorConfig;
  createPriceData(price: number, timestamp: number): PriceData;
  createHistoricalPriceSeries(prices: PriceData[], startSlot: number, oraclePubkey: PublicKey): HistoricalPriceSeries;
  calculateTWAP(prices: PriceData[], windowMs: number): number;
}

export const OracleUtils: OracleUtils = {
  createLagInjectorConfig(lagMs: number, lagSlots: number, replaySpeed: number = 1): LagInjectorConfig {
    return { lagMs, lagSlots, replaySpeed };
  },

  createPriceData(price: number, timestamp: number): PriceData {
    return { price, timestamp };
  },

  createHistoricalPriceSeries(
    prices: PriceData[],
    startSlot: number,
    oraclePubkey: PublicKey
  ): HistoricalPriceSeries {
    return { prices, startSlot, oraclePubkey };
  },

  calculateTWAP(prices: PriceData[], windowMs: number): number {
    if (prices.length === 0) return 0;
    const now = prices[prices.length - 1].timestamp;
    const cutoff = now - windowMs;
    const windowPrices = prices.filter(p => p.timestamp >= cutoff);
    if (windowPrices.length === 0) return prices[prices.length - 1].price;
    const sum = windowPrices.reduce((acc, p) => acc + p.price, 0);
    return sum / windowPrices.length;
  }
};

export function getHistoricalPriceSeries(): HistoricalPriceSeries[] {
  // Last three JitoSOL depeg series (simplified for test harness)
  const now = Math.floor(Date.now() / 1000);
  const series1: PriceData[] = [
    OracleUtils.createPriceData(0.98, now - 300),
    OracleUtils.createPriceData(0.95, now - 240),
    OracleUtils.createPriceData(0.88, now - 180),
    OracleUtils.createPriceData(0.75, now - 120),
    OracleUtils.createPriceData(0.65, now - 60),
  ];
  const series2: PriceData[] = [
    OracleUtils.createPriceData(1.02, now - 420),
    OracleUtils.createPriceData(0.99, now - 360),
    OracleUtils.createPriceData(0.92, now - 300),
    OracleUtils.createPriceData(0.81, now - 180),
  ];
  const series3: PriceData[] = [
    OracleUtils.createPriceData(0.97, now - 180),
    OracleUtils.createPriceData(0.94, now - 120),
    OracleUtils.createPriceData(0.85, now - 90),
    OracleUtils.createPriceData(0.72, now - 30),
  ];

  const oracle = new PublicKey("J1toso1uCk3RLmP1m4r4k1v3n7z4z4z4z4z4z4z4z4"); // placeholder jitoSOL oracle
  return [
    OracleUtils.createHistoricalPriceSeries(series1, 1000, oracle),
    OracleUtils.createHistoricalPriceSeries(series2, 1200, oracle),
    OracleUtils.createHistoricalPriceSeries(series3, 1400, oracle),
  ];
}

export function checkTWAPFalsePositive(series: HistoricalPriceSeries, twapWindowMs: number = 45000): boolean {
  const twap = OracleUtils.calculateTWAP(series.prices, twapWindowMs);
  const latest = series.prices[series.prices.length - 1].price;
  // False positive if TWAP stays above breaker threshold while price has depegged
  return twap > 0.85 && latest < 0.80;
}
