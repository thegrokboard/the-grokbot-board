import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  startSlot: number;
  endSlot: number;
}

export interface LagInjectorConfig {
  lagMs: number;
  lagSlots: number;
  series: HistoricalPriceSeries[];
  filter?: (p: PriceData) => boolean;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  updateFrequencyMs: number;
}

export interface TWAPConfig {
  windowMs: number;
  thresholdBps: number;
}

export class OracleUtils {
  static createLagInjectorConfig(
    lagMs: number,
    lagSlots: number,
    series: HistoricalPriceSeries[],
    filter?: (p: PriceData) => boolean
  ): LagInjectorConfig {
    return { lagMs, lagSlots, series, filter };
  }

  static getHistoricalPriceSeries(data: any): HistoricalPriceSeries[] {
    // Minimal stub that returns parsed series; in real sim this would load JitoSOL depeg data
    if (Array.isArray(data)) {
      return data as HistoricalPriceSeries[];
    }
    return [{
      prices: [],
      startSlot: 0,
      endSlot: 0,
    }];
  }

  static checkTWAPFalsePositive(
    series: HistoricalPriceSeries,
    twapConfig: TWAPConfig,
    lagMs: number
  ): boolean {
    if (series.prices.length < 2) return false;

    const windowMs = twapConfig.windowMs;
    const threshold = twapConfig.thresholdBps / 10000;

    let tripCount = 0;
    let falsePositive = false;

    for (let i = 1; i < series.prices.length; i++) {
      const prev = series.prices[i - 1];
      const curr = series.prices[i];
      const timeDelta = curr.timestamp - prev.timestamp;

      if (timeDelta > windowMs) {
        const priceDelta = Math.abs(curr.price - prev.price) / prev.price;
        if (priceDelta > threshold) {
          tripCount++;
          if (tripCount > 1) {
            falsePositive = true;
            break;
          }
        }
      }
    }

    return falsePositive;
  }
}

// Re-export for clean imports
export const createLagInjectorConfig = OracleUtils.createLagInjectorConfig;
export const getHistoricalPriceSeries = OracleUtils.getHistoricalPriceSeries;
export const checkTWAPFalsePositive = OracleUtils.checkTWAPFalsePositive;
