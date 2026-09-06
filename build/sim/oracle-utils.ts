import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  mint: string;
}

export interface LagInjectorConfig {
  lagSlots: number;
  oracleProgramId: PublicKey;
  oracleAccount: PublicKey;
  targetLagMs: number;
}

export interface OracleConfig {
  oracleAccount: PublicKey;
  oracleProgramId: PublicKey;
  updateFrequency: number;
}

export class OracleUtils {
  static createUpdatePriceInstruction(
    oracleProgramId: PublicKey,
    oracleAccount: PublicKey,
    priceData: PriceData
  ): TransactionInstruction {
    // Placeholder for Pyth/Switchboard update instruction; in test harness this is a no-op that logs the update
    return new TransactionInstruction({
      keys: [{ pubkey: oracleAccount, isSigner: false, isWritable: true }],
      programId: oracleProgramId,
      data: Buffer.from(JSON.stringify(priceData)),
    });
  }

  static async fetchHistoricalSeries(
    connection: Connection,
    mint: string,
    limit: number = 1000
  ): Promise<HistoricalPriceSeries> {
    // For the sim harness we return deterministic JitoSOL depeg series
    // Three example depeg events (price in USD)
    const basePrices: PriceData[] = [
      { price: 1.00, timestamp: Date.now() - 3600000 },
      { price: 0.98, timestamp: Date.now() - 2700000 },
      { price: 0.95, timestamp: Date.now() - 1800000 },
      { price: 0.92, timestamp: Date.now() - 900000 },
      { price: 0.89, timestamp: Date.now() - 600000 },
      { price: 0.87, timestamp: Date.now() - 300000 },
      { price: 0.85, timestamp: Date.now() - 120000 },
      { price: 0.84, timestamp: Date.now() - 60000 },
      { price: 0.83, timestamp: Date.now() - 30000 },
      { price: 1.00, timestamp: Date.now() },
    ];

    // Duplicate and shift for three distinct series
    const series1 = basePrices.map((p, i) => ({
      price: p.price * (1 - i * 0.005),
      timestamp: p.timestamp + i * 15000,
    }));

    const series2 = basePrices.map((p, i) => ({
      price: Math.max(0.75, p.price - 0.12 + Math.sin(i) * 0.03),
      timestamp: p.timestamp + 45000 + i * 15000,
    }));

    const series3 = basePrices.map((p, i) => ({
      price: p.price * 0.91 + (i % 3 === 0 ? -0.04 : 0.02),
      timestamp: p.timestamp + 90000 + i * 15000,
    }));

    const allPrices = [...series1, ...series2, ...series3]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, limit);

    return {
      prices: allPrices,
      mint,
    };
  }

  static getHistoricalPriceSeries(series: HistoricalPriceSeries, startIndex: number, count: number): PriceData[] {
    if (!series || !series.prices) return [];
    const end = Math.min(startIndex + count, series.prices.length);
    return series.prices.slice(startIndex, end);
  }

  static calculateTWAP(prices: PriceData[], windowSeconds: number = 15): number {
    if (prices.length === 0) return 0;
    const now = prices[prices.length - 1].timestamp;
    const cutoff = now - windowSeconds * 1000;
    const windowPrices = prices.filter(p => p.timestamp >= cutoff);
    if (windowPrices.length === 0) return prices[prices.length - 1].price;
    const sum = windowPrices.reduce((acc, p) => acc + p.price, 0);
    return sum / windowPrices.length;
  }
}

export default OracleUtils;
