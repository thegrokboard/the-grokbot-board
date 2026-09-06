import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, TransactionInstruction } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";

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
  priceAccount: PublicKey;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  priceAccount: PublicKey;
  lagSlots: number;
}

export class OracleUtils {
  static createLagInjectorConfig(
    oraclePubkey: PublicKey,
    priceAccount: PublicKey,
    lagMs: number = 45000
  ): LagInjectorConfig {
    return {
      lagMs,
      oraclePubkey,
      priceAccount,
    };
  }

  static createOracleConfig(
    oraclePubkey: PublicKey,
    priceAccount: PublicKey,
    lagSlots: number = 90
  ): OracleConfig {
    return {
      oraclePubkey,
      priceAccount,
      lagSlots,
    };
  }

  static getHistoricalPriceSeries(): HistoricalPriceSeries {
    // Last three simulated JitoSOL depeg price series (price in USD, timestamp in seconds)
    // Series chosen to test drawdown circuit-breaker logic around a 10% drop
    return {
      prices: [
        // Series 1: gradual 12% drop over ~2min
        { price: 0.98, timestamp: 1725000000 },
        { price: 0.97, timestamp: 1725000060 },
        { price: 0.95, timestamp: 1725000120 },
        { price: 0.92, timestamp: 1725000180 },
        { price: 0.89, timestamp: 1725000240 },
        { price: 0.87, timestamp: 1725000300 },
        // Series 2: fast crash then partial recovery
        { price: 0.99, timestamp: 1725000600 },
        { price: 0.85, timestamp: 1725000615 },
        { price: 0.78, timestamp: 1725000630 },
        { price: 0.81, timestamp: 1725000660 },
        { price: 0.88, timestamp: 1725000720 },
        // Series 3: slow bleed over longer window
        { price: 0.995, timestamp: 1725001200 },
        { price: 0.98, timestamp: 1725001500 },
        { price: 0.94, timestamp: 1725001800 },
        { price: 0.91, timestamp: 1725002100 },
        { price: 0.905, timestamp: 1725002400 },
      ],
    };
  }

  static computeTWAP(series: HistoricalPriceSeries, windowSeconds: number = 900): number {
    if (!series.prices.length) return 0;
    const now = Math.max(...series.prices.map((p) => p.timestamp));
    const cutoff = now - windowSeconds;
    const windowed = series.prices.filter((p) => p.timestamp >= cutoff);
    if (!windowed.length) return series.prices[series.prices.length - 1].price;
    const sum = windowed.reduce((acc, p) => acc + p.price, 0);
    return sum / windowed.length;
  }

  static checkTWAPFalsePositive(
    series: HistoricalPriceSeries,
    currentPrice: number,
    twapWindowSeconds: number = 900,
    threshold: number = 0.1
  ): boolean {
    const twap = OracleUtils.computeTWAP(series, twapWindowSeconds);
    const drawdown = (twap - currentPrice) / twap;
    return drawdown < threshold;
  }
}

export { OracleUtils };
export type { PriceData, HistoricalPriceSeries, LagInjectorConfig, OracleConfig };
