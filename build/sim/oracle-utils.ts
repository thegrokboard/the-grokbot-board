import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction, Connection, Keypair } from "@solana/web3.js";
import { PythSolanaReceiver, getPythProgramKeyForCluster } from "@pythnetwork/pyth-solana-receiver";
import { PriceUpdateV2 } from "@pythnetwork/pyth-solana-receiver-types";

export interface PriceData {
  price: number;
  publishTime: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  symbol: string;
}

export interface LagInjectorConfig {
  lagSlots: number;
  oracleProgramId: PublicKey;
  priceFeedId: PublicKey;
  targetLagSeconds: number;
}

export interface OracleConfig {
  pythPriceFeed: PublicKey;
  updateAuthority: PublicKey;
  lagSlots: number;
}

export class OracleUtils {
  private connection: Connection;
  private receiver: PythSolanaReceiver;

  constructor(connection: Connection, wallet: anchor.Wallet) {
    this.connection = connection;
    this.receiver = new PythSolanaReceiver({
      connection,
      wallet: wallet.payer,
    });
  }

  static getHistoricalPriceSeries(): HistoricalPriceSeries {
    // JitoSOL depeg series (simulated last three depeg events)
    return {
      symbol: "jitoSOL",
      prices: [
        // Event 1 - mild depeg
        { price: 0.98, publishTime: 1725000000 },
        { price: 0.97, publishTime: 1725000030 },
        { price: 0.95, publishTime: 1725000060 },
        { price: 0.92, publishTime: 1725000090 },
        { price: 0.90, publishTime: 1725000120 },
        // Event 2 - sharp depeg
        { price: 0.89, publishTime: 1725100000 },
        { price: 0.85, publishTime: 1725100030 },
        { price: 0.78, publishTime: 1725100060 },
        { price: 0.75, publishTime: 1725100090 },
        { price: 0.72, publishTime: 1725100120 },
        // Event 3 - recovery
        { price: 0.75, publishTime: 1725200000 },
        { price: 0.82, publishTime: 1725200030 },
        { price: 0.91, publishTime: 1725200060 },
        { price: 0.96, publishTime: 1725200090 },
        { price: 0.99, publishTime: 1725200120 },
      ],
    };
  }

  static async createUpdatePriceInstruction(
    connection: Connection,
    priceFeedId: PublicKey,
    priceData: PriceData,
    slot: number
  ): Promise<TransactionInstruction> {
    const pythProgram = getPythProgramKeyForCluster("devnet");
    // In sim we use a mock update that sets the price at a specific slot
    const data = Buffer.alloc(32);
    data.writeBigUInt64LE(BigInt(Math.floor(priceData.price * 1_000_000)), 0);
    data.writeBigUInt64LE(BigInt(priceData.publishTime), 8);
    data.writeUInt32LE(slot, 16);

    return new TransactionInstruction({
      keys: [
        { pubkey: priceFeedId, isSigner: false, isWritable: true },
        { pubkey: pythProgram, isSigner: false, isWritable: false },
      ],
      programId: pythProgram,
      data,
    });
  }

  static getTWAP(prices: PriceData[], windowSeconds: number = 15): number {
    if (prices.length === 0) return 0;
    const now = Math.max(...prices.map(p => p.publishTime));
    const cutoff = now - windowSeconds;
    const windowPrices = prices.filter(p => p.publishTime >= cutoff);
    if (windowPrices.length === 0) return prices[prices.length - 1].price;
    const sum = windowPrices.reduce((acc, p) => acc + p.price, 0);
    return sum / windowPrices.length;
  }

  async updateOracleWithLag(
    priceFeed: PublicKey,
    series: HistoricalPriceSeries,
    lagSlots: number,
    currentSlot: number
  ): Promise<void> {
    const lagTime = lagSlots * 0.4; // rough seconds per slot
    for (let i = 0; i < series.prices.length; i++) {
      const price = series.prices[i];
      const laggedTime = Math.floor(price.publishTime - lagTime);
      const laggedSlot = currentSlot - lagSlots + i;
      const ix = await OracleUtils.createUpdatePriceInstruction(
        this.connection,
        priceFeed,
        { price: price.price, publishTime: laggedTime },
        laggedSlot
      );
      // In test harness this would be sent; here we just simulate
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  static checkTWAPFalsePositive(
    series: HistoricalPriceSeries,
    twapThreshold: number = 0.90,
    windowSeconds: number = 15
  ): boolean {
    const twap = OracleUtils.getTWAP(series.prices, windowSeconds);
    return twap > twapThreshold;
  }
}

export default OracleUtils;
export { OracleUtils };
export type { PriceData, HistoricalPriceSeries, LagInjectorConfig, OracleConfig };
