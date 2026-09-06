import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
}

export interface LagInjectorConfig {
  lagSlots: number;
  targetLagSeconds: number;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  priceFeed: PublicKey;
}

export class OracleUtils {
  static createUpdatePriceInstruction(
    oraclePubkey: PublicKey,
    price: number,
    slot: number
  ): TransactionInstruction {
    // Placeholder for Switchboard/Jito-style oracle update (real sim uses mock)
    return new TransactionInstruction({
      keys: [{ pubkey: oraclePubkey, isSigner: false, isWritable: true }],
      programId: new PublicKey("11111111111111111111111111111111"),
      data: Buffer.from([price, slot]),
    });
  }

  static getHistoricalPriceSeries(prices: PriceData[]): HistoricalPriceSeries {
    return { prices };
  }

  static calculateTWAP(series: HistoricalPriceSeries, windowSeconds: number): number {
    if (series.prices.length === 0) return 0;
    const now = series.prices[series.prices.length - 1].timestamp;
    const cutoff = now - windowSeconds;
    const relevant = series.prices.filter(p => p.timestamp >= cutoff);
    if (relevant.length === 0) return series.prices[series.prices.length - 1].price;
    const sum = relevant.reduce((acc, p) => acc + p.price, 0);
    return sum / relevant.length;
  }
}

export function checkTWAPFalsePositive(
  series: HistoricalPriceSeries,
  currentPrice: number,
  twapWindowSeconds: number = 15
): boolean {
  const twap = OracleUtils.calculateTWAP(series, twapWindowSeconds);
  // Simple false-positive heuristic: breaker would trip on >10% deviation but this is within normal Jito volatility
  const deviation = Math.abs(currentPrice - twap) / twap;
  return deviation < 0.12;
}

// Re-export for convenience
export { OracleUtils };
