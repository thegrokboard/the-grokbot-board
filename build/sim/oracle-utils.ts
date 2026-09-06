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

export interface TWAP {
  value: number;
  startSlot: number;
  endSlot: number;
}

export interface LagInjectorConfig {
  lagMs: number;
  slotDurationMs: number;
  oracleProgramId: PublicKey;
  oracleAccount: PublicKey;
}

export interface OracleConfig {
  lagSlots: number;
  updateInterval: number;
}

export class OracleUtils {
  static createPriceFeed(mint: string, prices: PriceData[]): HistoricalPriceSeries {
    return { mint, prices };
  }

  static calculateTWAP(series: HistoricalPriceSeries, windowMs: number = 15000): TWAP {
    if (series.prices.length === 0) {
      return { value: 0, startSlot: 0, endSlot: 0 };
    }

    const sorted = [...series.prices].sort((a, b) => a.timestamp - b.timestamp);
    const now = sorted[sorted.length - 1].timestamp;
    const windowStart = now - windowMs;

    const windowPrices = sorted.filter(p => p.timestamp >= windowStart);
    if (windowPrices.length === 0) {
      return { value: sorted[sorted.length - 1].price, startSlot: 0, endSlot: 0 };
    }

    const sum = windowPrices.reduce((acc, p) => acc + p.price, 0);
    const avg = sum / windowPrices.length;

    return {
      value: avg,
      startSlot: Math.floor(windowStart / 400),
      endSlot: Math.floor(now / 400)
    };
  }

  static checkTWAPFalsePositive(
    series: HistoricalPriceSeries,
    twapThreshold: number = 0.05,
    windowMs: number = 15000
  ): boolean {
    const twap = OracleUtils.calculateTWAP(series, windowMs);
    if (twap.value === 0) return false;

    const latest = series.prices[series.prices.length - 1].price;
    const deviation = Math.abs(latest - twap.value) / twap.value;
    return deviation > twapThreshold;
  }

  static simulateLag(
    series: HistoricalPriceSeries,
    lagMs: number
  ): HistoricalPriceSeries {
    const laggedPrices = series.prices.map(p => ({
      price: p.price,
      timestamp: p.timestamp + lagMs
    }));
    return { mint: series.mint, prices: laggedPrices };
  }
}

export function checkTWAPFalsePositive(
  series: HistoricalPriceSeries,
  twapThreshold: number = 0.05,
  windowMs: number = 15000
): boolean {
  return OracleUtils.checkTWAPFalsePositive(series, twapThreshold, windowMs);
}
