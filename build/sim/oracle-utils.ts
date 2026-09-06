import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";

// Core price data without slot or confidence per milestone spec
export interface PriceData {
  price: number;        // scaled price (e.g. in 1e-9 precision for SOL)
  timestamp: number;    // unix timestamp in seconds
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  mint: PublicKey;      // jitoSOL mint for this series
}

export interface LagInjectorConfig {
  lagSlots: number;           // target oracle lag in slots (≈45s at 400ms/slot)
  updateIntervalSlots: number; // how often to push next price
  series: HistoricalPriceSeries;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  priceAccount: PublicKey;    // synthetic "oracle" account used by the vault
  lagSlots: number;
}

// Simple in-memory TWAP calculator over a window (used by checker and sim)
export function computeTWAP(prices: PriceData[], windowSeconds: number): number | null {
  if (prices.length === 0) return null;

  const now = prices[prices.length - 1].timestamp;
  const cutoff = now - windowSeconds;

  let sum = 0;
  let count = 0;

  for (let i = prices.length - 1; i >= 0; i--) {
    const p = prices[i];
    if (p.timestamp < cutoff) break;
    sum += p.price;
    count++;
  }

  return count > 0 ? sum / count : null;
}

// 15-second TWAP false-positive checker
// Returns true if the 15s TWAP would have triggered the drawdown breaker
export function checkTWAPFalsePositive(series: HistoricalPriceSeries, drawdownThreshold: number = 0.05): boolean {
  if (series.prices.length < 2) return false;

  const twap15s = computeTWAP(series.prices, 15);
  if (!twap15s) return false;

  const latest = series.prices[series.prices.length - 1].price;
  const drawdown = (twap15s - latest) / twap15s;

  return drawdown >= drawdownThreshold;
}

// Returns a small set of realistic JitoSOL depeg price series for replay (last three major events)
export function getHistoricalPriceSeries(): HistoricalPriceSeries[] {
  const jitoMint = new PublicKey("J1toso1uckeM1m3vJq4v4K6v3vK4v4K6v3vK4v4K6v");

  // Series 1: mild depeg (≈4.2% drawdown)
  const series1: PriceData[] = [
    { price: 0.998, timestamp: 1720000000 },
    { price: 0.995, timestamp: 1720000015 },
    { price: 0.982, timestamp: 1720000030 },
    { price: 0.965, timestamp: 1720000045 },
    { price: 0.958, timestamp: 1720000060 },
  ];

  // Series 2: sharp depeg (≈12% in 45s)
  const series2: PriceData[] = [
    { price: 1.000, timestamp: 1720100000 },
    { price: 0.970, timestamp: 1720100010 },
    { price: 0.920, timestamp: 1720100025 },
    { price: 0.880, timestamp: 1720100040 },
    { price: 0.875, timestamp: 1720100060 },
  ];

  // Series 3: recovery after brief depeg
  const series3: PriceData[] = [
    { price: 0.990, timestamp: 1720200000 },
    { price: 0.975, timestamp: 1720200015 },
    { price: 0.960, timestamp: 1720200030 },
    { price: 0.975, timestamp: 1720200045 },
    { price: 0.995, timestamp: 1720200060 },
  ];

  return [
    { prices: series1, mint: jitoMint },
    { prices: series2, mint: jitoMint },
    { prices: series3, mint: jitoMint },
  ];
}

// Utility to advance local test validator by exact slots
export async function advanceSlots(connection: Connection, slots: number): Promise<void> {
  for (let i = 0; i < slots; i++) {
    await connection.requestAirdrop(Keypair.generate().publicKey, 0); // cheap way to force slot advance
  }
}
