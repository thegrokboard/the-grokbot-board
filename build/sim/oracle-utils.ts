import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
}

export interface LagInjectorConfig {
  lagMs: number;
  oraclePubkey: PublicKey;
}

export interface OracleConfig {
  lagSlots: number;
  oraclePubkey: PublicKey;
}

export interface TWAPCheckResult {
  tripped: boolean;
  currentTWAP: number;
  depegThreshold: number;
  reason: string;
}

export class OracleUtils {
  static createPriceData(price: number, timestamp: number): PriceData {
    return { price, timestamp };
  }

  static createHistoricalPriceSeries(prices: PriceData[]): HistoricalPriceSeries {
    return { prices };
  }

  static createLagInjectorConfig(lagMs: number, oraclePubkey: PublicKey): LagInjectorConfig {
    return { lagMs, oraclePubkey };
  }

  static createOracleConfig(lagSlots: number, oraclePubkey: PublicKey): OracleConfig {
    return { lagSlots, oraclePubkey };
  }

  static checkTWAPFalsePositive(
    series: HistoricalPriceSeries,
    windowMs: number,
    depegThreshold: number
  ): TWAPCheckResult {
    if (series.prices.length < 2) {
      return {
        tripped: false,
        currentTWAP: 0,
        depegThreshold,
        reason: "insufficient data",
      };
    }

    const sorted = [...series.prices].sort((a, b) => a.timestamp - b.timestamp);
    const now = sorted[sorted.length - 1].timestamp;
    const windowStart = now - windowMs;

    const windowPrices = sorted.filter((p) => p.timestamp >= windowStart);
    if (windowPrices.length === 0) {
      return {
        tripped: false,
        currentTWAP: 0,
        depegThreshold,
        reason: "no prices in window",
      };
    }

    const sum = windowPrices.reduce((acc, p) => acc + p.price, 0);
    const twap = sum / windowPrices.length;

    const tripped = twap < depegThreshold;

    return {
      tripped,
      currentTWAP: twap,
      depegThreshold,
      reason: tripped ? "TWAP below threshold" : "within bounds",
    };
  }

  static async getHistoricalPriceSeries(
    connection: anchor.web3.Connection,
    oracle: PublicKey,
    limit: number = 100
  ): Promise<HistoricalPriceSeries> {
    // In sim we replay static data; real implementation would read from account history.
    // For test-validator sim we return empty and let lag-injector populate.
    return { prices: [] };
  }
}

export const checkTWAPFalsePositive = OracleUtils.checkTWAPFalsePositive;
export { OracleUtils };
