import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";

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
    lagMs: number,
    oraclePubkey: PublicKey,
    priceAccount: PublicKey
  ): LagInjectorConfig {
    return { lagMs, oraclePubkey, priceAccount };
  }

  static createOracleConfig(
    oraclePubkey: PublicKey,
    priceAccount: PublicKey,
    lagSlots: number
  ): OracleConfig {
    return { oraclePubkey, priceAccount, lagSlots };
  }

  static async fetchHistoricalSeries(
    connection: Connection,
    priceAccount: PublicKey,
    count: number = 100
  ): Promise<HistoricalPriceSeries> {
    // Mock historical data for simulation (in real use would pull from on-chain history or external feed)
    const now = Math.floor(Date.now() / 1000);
    const prices: PriceData[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const price = 0.95 + Math.sin(i / 10) * 0.08; // simulate JitoSOL depeg around 0.9x
      prices.push({
        price: Math.max(price, 0.75),
        timestamp: now - i * 15,
      });
    }
    return { prices: prices.reverse() };
  }

  static getPriceAtLag(
    series: HistoricalPriceSeries,
    lagMs: number,
    currentSlot: number
  ): PriceData | null {
    if (!series.prices.length) return null;
    const targetTime = Date.now() - lagMs;
    let closest = series.prices[0];
    let minDiff = Math.abs(closest.timestamp * 1000 - targetTime);
    for (const p of series.prices) {
      const diff = Math.abs(p.timestamp * 1000 - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = p;
      }
    }
    return closest;
  }

  static calculateTWAP(
    series: HistoricalPriceSeries,
    windowSeconds: number = 15
  ): number {
    if (!series.prices.length) return 0;
    const now = Date.now() / 1000;
    const cutoff = now - windowSeconds;
    const recent = series.prices.filter((p) => p.timestamp >= cutoff);
    if (!recent.length) return series.prices[series.prices.length - 1].price;
    const sum = recent.reduce((acc, p) => acc + p.price, 0);
    return sum / recent.length;
  }

  static checkTWAPFalsePositive(
    series: HistoricalPriceSeries,
    threshold: number = 0.85,
    windowSeconds: number = 15
  ): boolean {
    const twap = OracleUtils.calculateTWAP(series, windowSeconds);
    return twap > threshold;
  }
}

export { OracleUtils };
export type { PriceData, HistoricalPriceSeries, LagInjectorConfig, OracleConfig };
