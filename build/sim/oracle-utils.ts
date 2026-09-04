import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export interface PriceData {
  price: number;
  confidence: number;
  timestamp: number;
  slot: number;
}

export type HistoricalPriceSeries = PriceData[];

export function getHistoricalJitoPrices(): HistoricalPriceSeries {
  // Realistic replay of the last three JitoSOL depeg events (simplified for test harness)
  // Prices are normalized around $1.0; depegs shown as drops with timestamps in seconds
  return [
    // Event 1: minor depeg
    { price: 0.998, confidence: 0.95, timestamp: 1700000000, slot: 1000 },
    { price: 0.992, confidence: 0.92, timestamp: 1700000015, slot: 1015 },
    { price: 0.985, confidence: 0.88, timestamp: 1700000030, slot: 1030 },
    { price: 0.978, confidence: 0.85, timestamp: 1700000045, slot: 1045 },
    { price: 0.975, confidence: 0.82, timestamp: 1700000060, slot: 1060 },
    // Event 2: sharp depeg
    { price: 0.965, confidence: 0.78, timestamp: 1700100000, slot: 2000 },
    { price: 0.920, confidence: 0.65, timestamp: 1700100015, slot: 2015 },
    { price: 0.880, confidence: 0.55, timestamp: 1700100030, slot: 2030 },
    { price: 0.850, confidence: 0.48, timestamp: 1700100045, slot: 2045 },
    { price: 0.840, confidence: 0.45, timestamp: 1700100060, slot: 2060 },
    // Event 3: recovery after depeg
    { price: 0.910, confidence: 0.60, timestamp: 1700200000, slot: 3000 },
    { price: 0.950, confidence: 0.75, timestamp: 1700200015, slot: 3015 },
    { price: 0.975, confidence: 0.85, timestamp: 1700200030, slot: 3030 },
    { price: 0.990, confidence: 0.92, timestamp: 1700200045, slot: 3045 },
    { price: 0.998, confidence: 0.96, timestamp: 1700200060, slot: 3060 },
  ];
}

export function getPriceAtLag(series: HistoricalPriceSeries, lagSeconds: number): PriceData | null {
  if (series.length === 0) return null;
  const now = Math.max(...series.map(p => p.timestamp));
  const targetTime = now - lagSeconds;
  let closest = series[0];
  let minDiff = Math.abs(closest.timestamp - targetTime);
  for (const p of series) {
    const diff = Math.abs(p.timestamp - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      closest = p;
    }
  }
  return closest;
}

export function createTestOracleAccount(
  program: anchor.Program,
  initialPrice: number
): Promise<PublicKey> {
  // In pure-onchain sim we use a mocked PDA; real implementation would init Switchboard or Pyth account
  return Promise.resolve(PublicKey.unique());
}
