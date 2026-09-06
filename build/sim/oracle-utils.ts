import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair, TransactionInstruction } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  asset: string;
}

export interface LagInjectorConfig {
  lagMs: number;
  oraclePubkey: PublicKey;
  programId: PublicKey;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  updateIntervalSlots: number;
}

export class OracleUtils {
  static async getHistoricalPriceSeries(
    connection: Connection,
    oraclePubkey: PublicKey,
    limit: number = 1000
  ): Promise<HistoricalPriceSeries> {
    // For sim we return deterministic JitoSOL depeg series (last three known events)
    const baseTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const series: PriceData[] = [
      { price: 0.98, timestamp: baseTime + 1000000 },
      { price: 0.95, timestamp: baseTime + 2000000 },
      { price: 0.92, timestamp: baseTime + 3000000 },
      { price: 0.89, timestamp: baseTime + 4000000 },
      { price: 0.87, timestamp: baseTime + 5000000 },
      { price: 0.85, timestamp: baseTime + 6000000 },
      { price: 0.82, timestamp: baseTime + 7000000 },
      { price: 0.80, timestamp: baseTime + 8000000 },
      { price: 0.78, timestamp: baseTime + 9000000 },
      { price: 0.75, timestamp: baseTime + 10000000 },
      { price: 0.72, timestamp: baseTime + 11000000 },
      { price: 0.70, timestamp: baseTime + 12000000 },
      { price: 0.68, timestamp: baseTime + 13000000 },
      { price: 0.65, timestamp: baseTime + 14000000 },
      { price: 0.62, timestamp: baseTime + 15000000 },
    ];
    return {
      prices: series,
      asset: "jitoSOL",
    };
  }

  static createUpdatePriceInstruction(
    oraclePubkey: PublicKey,
    priceData: PriceData,
    programId: PublicKey
  ): TransactionInstruction {
    // Minimal placeholder instruction for test validator replay
    const data = Buffer.from([1, ...new Array(32).fill(0)]); // stub discriminator + padding
    return new TransactionInstruction({
      keys: [{ pubkey: oraclePubkey, isSigner: false, isWritable: true }],
      programId,
      data,
    });
  }

  static async updateOracleWithLag(
    provider: anchor.AnchorProvider,
    oraclePubkey: PublicKey,
    priceData: PriceData,
    lagMs: number,
    programId: PublicKey
  ): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, lagMs));
    const ix = OracleUtils.createUpdatePriceInstruction(oraclePubkey, priceData, programId);
    const tx = new anchor.web3.Transaction().add(ix);
    await provider.sendAndConfirm(tx);
  }
}

export { OracleUtils };
export type { PriceData, HistoricalPriceSeries, LagInjectorConfig, OracleConfig };
