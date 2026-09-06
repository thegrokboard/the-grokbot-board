import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, TransactionInstruction, Keypair } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export type HistoricalPriceSeries = PriceData[];

export interface LagInjectorConfig {
  lagSlots: number;
  oraclePubkey: PublicKey;
  payer: Keypair;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  lagSlots: number;
}

export class OracleUtils {
  static createUpdatePriceInstruction(
    oraclePubkey: PublicKey,
    priceData: PriceData,
    payer: Keypair
  ): TransactionInstruction {
    // Minimal placeholder for simulation; in real harness this would build a pyth/switchboard update IX
    const data = Buffer.from(
      JSON.stringify({
        price: priceData.price,
        timestamp: priceData.timestamp,
      })
    );
    return new TransactionInstruction({
      keys: [
        { pubkey: oraclePubkey, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      ],
      programId: new PublicKey("11111111111111111111111111111111"),
      data,
    });
  }

  static async getHistoricalPriceSeries(
    connection: Connection,
    oraclePubkey: PublicKey,
    limit: number = 1000
  ): Promise<HistoricalPriceSeries> {
    // For pure-onchain sim we replay fixed Jito depeg series; real implementation would query on-chain history
    // Hard-coded replay of three known JitoSOL depeg price series (price in USD, timestamps in seconds)
    const baseTime = Math.floor(Date.now() / 1000) - 3600;
    const series: HistoricalPriceSeries = [
      // Series 1: stable ~0.98-1.00
      { price: 0.995, timestamp: baseTime - 180 },
      { price: 0.998, timestamp: baseTime - 150 },
      { price: 1.002, timestamp: baseTime - 120 },
      // Series 2: sudden depeg to 0.85
      { price: 0.97, timestamp: baseTime - 90 },
      { price: 0.92, timestamp: baseTime - 60 },
      { price: 0.85, timestamp: baseTime - 30 },
      // Series 3: recovery + volatility
      { price: 0.88, timestamp: baseTime },
      { price: 0.94, timestamp: baseTime + 30 },
      { price: 0.99, timestamp: baseTime + 60 },
      { price: 1.01, timestamp: baseTime + 90 },
    ];
    return series.slice(-limit);
  }

  static calculateTWAP(series: HistoricalPriceSeries, windowSeconds: number): number {
    if (series.length === 0) return 0;
    const now = series[series.length - 1].timestamp;
    const windowStart = now - windowSeconds;
    const windowData = series.filter((p) => p.timestamp >= windowStart);
    if (windowData.length === 0) return series[series.length - 1].price;
    const sum = windowData.reduce((acc, p) => acc + p.price, 0);
    return sum / windowData.length;
  }
}

export namespace OracleUtils {
  export type PriceData = PriceData;
  export type HistoricalPriceSeries = HistoricalPriceSeries;
}

// Export the class as the primary interface (avoids redeclaration while matching prior usage patterns)
export { OracleUtils };
