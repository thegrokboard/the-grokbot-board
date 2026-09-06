import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, TransactionInstruction, Keypair } from "@solana/web3.js";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  symbol: string;
  prices: PriceData[];
}

export interface LagInjectorConfig {
  lagSlots: number;
  oracleProgramId: PublicKey;
  priceFeedId: PublicKey;
}

export interface OracleConfig {
  lagSlots: number;
  priceFeed: string;
}

export class OracleUtils {
  static async getHistoricalPriceSeries(
    connection: Connection,
    feedId: PublicKey,
    numPrices: number = 100
  ): Promise<HistoricalPriceSeries> {
    // For sim we replay known JitoSOL depeg series; in real would pull from Pyth history
    const basePrice = 0.95;
    const series: PriceData[] = [];
    const now = Math.floor(Date.now() / 1000);
    for (let i = numPrices - 1; i >= 0; i--) {
      const deviation = i < 20 ? (20 - i) * 0.012 : 0; // simulate depeg
      series.push({
        price: basePrice + deviation,
        timestamp: now - i * 15,
      });
    }
    return {
      symbol: "jitoSOL",
      prices: series.reverse(),
    };
  }

  static createUpdatePriceInstruction(
    oracleConfig: OracleConfig,
    priceData: PriceData,
    payer: PublicKey
  ): TransactionInstruction {
    // Stub for sim - in real this would build a Pyth update ix with lagged data
    return new TransactionInstruction({
      keys: [{ pubkey: payer, isSigner: true, isWritable: true }],
      programId: new PublicKey("Pyth111111111111111111111111111111111111111"),
      data: Buffer.from([1, 2, 3]), // placeholder
    });
  }

  static checkTWAPFalsePositive(
    series: HistoricalPriceSeries,
    twapPeriodSlots: number = 15
  ): boolean {
    if (series.prices.length < twapPeriodSlots) return false;
    const recent = series.prices.slice(-twapPeriodSlots);
    const sum = recent.reduce((acc, p) => acc + p.price, 0);
    const twap = sum / recent.length;
    const lastPrice = recent[recent.length - 1].price;
    // False-positive if TWAP stays above 0.90 while spot dipped hard (sim depeg threshold)
    return twap > 0.90 && lastPrice < 0.85;
  }
}

export const getHistoricalPriceSeries = OracleUtils.getHistoricalPriceSeries;
export { OracleUtils };
export const checkTWAPFalsePositive = OracleUtils.checkTWAPFalsePositive;
