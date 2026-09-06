import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  mint: string;
  prices: PriceData[];
}

export interface LagInjectorConfig {
  lagMs: number;
  slotMs: number;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  mint: PublicKey;
  updateInterval: number;
}

export class OracleUtils {
  static createLagInjectorConfig(lagMs: number = 45000, slotMs: number = 400): LagInjectorConfig {
    return { lagMs, slotMs };
  }

  static getHistoricalPriceSeries(mint: string, prices: PriceData[]): HistoricalPriceSeries {
    return { mint, prices };
  }

  static filterSeries(series: HistoricalPriceSeries, startTime: number, endTime: number): PriceData[] {
    return series.prices.filter(p => p.timestamp >= startTime && p.timestamp <= endTime);
  }

  static toSlot(timestamp: number, slotMs: number): number {
    return Math.floor(timestamp / slotMs);
  }

  static createOracleConfig(oraclePubkey: PublicKey, mint: PublicKey, updateInterval: number = 15): OracleConfig {
    return { oraclePubkey, mint, updateInterval };
  }
}

export function checkTWAPFalsePositive(prices: PriceData[], twapPeriodMs: number = 15000): boolean {
  if (prices.length < 2) return false;
  const sorted = [...prices].sort((a, b) => a.timestamp - b.timestamp);
  const start = sorted[0].timestamp;
  const end = sorted[sorted.length - 1].timestamp;
  if (end - start < twapPeriodMs) return false;

  let sum = 0;
  let count = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].timestamp <= start + twapPeriodMs) {
      sum += sorted[i].price;
      count++;
    } else {
      break;
    }
  }
  const twap = count > 0 ? sum / count : 0;
  const lastPrice = sorted[sorted.length - 1].price;
  return Math.abs(lastPrice - twap) / twap > 0.05; // 5% deviation threshold for false-positive test
}

export async function simulateOracleUpdate(
  provider: anchor.AnchorProvider,
  oraclePubkey: PublicKey,
  price: number,
  timestamp: number
): Promise<void> {
  // In test validator sim this is a no-op placeholder that logs (real impl would call a mock oracle program)
  console.log(`[SIM] Oracle update: ${oraclePubkey.toBase58()} price=${price} ts=${timestamp}`);
  // No actual transaction in this harness; lag injector drives timing
}
