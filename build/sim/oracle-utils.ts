import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { OracleConfig } from "./types";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  startSlot: number;
  currentSlot: number;
}

export interface LagInjectorConfig {
  lagSlots: number;
  targetLagSeconds: number;
  oraclePubkey: PublicKey;
  jitoSolMint: PublicKey;
}

export class OracleUtils {
  static createDefaultSeries(): HistoricalPriceSeries {
    return {
      prices: [],
      startSlot: 0,
      currentSlot: 0,
    };
  }

  static fromPriceHistory(prices: Array<{price: number; timestamp: number}>): HistoricalPriceSeries {
    const series: HistoricalPriceSeries = {
      prices: prices.map(p => ({ price: p.price, timestamp: p.timestamp })),
      startSlot: 100_000,
      currentSlot: 100_000 + prices.length * 4,
    };
    return series;
  }

  static getHistoricalPriceSeries(): HistoricalPriceSeries {
    // JitoSOL depeg replay data (last three known depeg episodes simplified)
    const raw = [
      // episode 1 - mild depeg
      { price: 0.98, timestamp: 1700000000 },
      { price: 0.95, timestamp: 1700000030 },
      { price: 0.92, timestamp: 1700000060 },
      { price: 0.90, timestamp: 1700000090 },
      { price: 0.88, timestamp: 1700000120 },
      { price: 0.95, timestamp: 1700000150 },
      // episode 2 - sharp depeg
      { price: 0.99, timestamp: 1700100000 },
      { price: 0.85, timestamp: 1700100030 },
      { price: 0.72, timestamp: 1700100060 },
      { price: 0.65, timestamp: 1700100090 },
      { price: 0.78, timestamp: 1700100120 },
      // episode 3 - slow bleed
      { price: 1.00, timestamp: 1700200000 },
      { price: 0.97, timestamp: 1700200030 },
      { price: 0.94, timestamp: 1700200060 },
      { price: 0.89, timestamp: 1700200090 },
      { price: 0.85, timestamp: 1700200120 },
      { price: 0.91, timestamp: 1700200150 },
    ];
    return OracleUtils.fromPriceHistory(raw);
  }

  static async updateOracleWithLag(
    connection: Connection,
    oracle: PublicKey,
    series: HistoricalPriceSeries,
    lagSlots: number,
    provider: anchor.AnchorProvider
  ): Promise<void> {
    const slot = await connection.getSlot();
    const effectiveIndex = Math.max(0, Math.min(series.prices.length - 1, slot - lagSlots - series.startSlot));
    const price = series.prices[effectiveIndex].price;

    // In real sim we would call a Switchboard or Pyth update instruction.
    // For test-validator harness we simply log and assume the on-chain oracle account
    // is being driven by a separate mock account updater (mocked via lag-injector).
    console.log(`[OracleUtils] slot=${slot} lag=${lagSlots} effectiveIdx=${effectiveIndex} price=${price.toFixed(4)}`);
  }

  static calculateTWAP(series: HistoricalPriceSeries, windowSeconds: number = 15 * 60): number {
    if (series.prices.length === 0) return 1.0;

    const now = series.prices[series.prices.length - 1].timestamp;
    const cutoff = now - windowSeconds;

    const windowPrices = series.prices.filter(p => p.timestamp >= cutoff);
    if (windowPrices.length === 0) return series.prices[series.prices.length - 1].price;

    const sum = windowPrices.reduce((acc, p) => acc + p.price, 0);
    return sum / windowPrices.length;
  }

  static checkTWAPFalsePositive(series: HistoricalPriceSeries, threshold: number = 0.88): boolean {
    const twap = OracleUtils.calculateTWAP(series);
    const latest = series.prices[series.prices.length - 1].price;
    const tripped = twap < threshold && latest > 0.95;
    return tripped;
  }
}

export const getHistoricalPriceSeries = OracleUtils.getHistoricalPriceSeries;
export const checkTWAPFalsePositive = OracleUtils.checkTWAPFalsePositive;
export { OracleUtils };
