import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction, Connection, Keypair } from "@solana/web3.js";
import BN from "bn.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  name: string;
  prices: PriceData[];
}

export interface LagInjectorConfig {
  lagMs: number;
  slotDurationMs?: number;
  filter?: (p: PriceData) => boolean;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  feedPubkey?: PublicKey;
  programId: PublicKey;
}

export class OracleUtils {
  static createUpdatePriceInstruction(
    oraclePubkey: PublicKey,
    price: number,
    timestamp: number,
    programId: PublicKey
  ): TransactionInstruction {
    // Minimal placeholder for on-chain oracle update (Switchboard/Jito style)
    const data = Buffer.from([1, ...new BN(price * 1e8).toArray("le", 8), ...new BN(timestamp).toArray("le", 8)]);
    return new TransactionInstruction({
      keys: [{ pubkey: oraclePubkey, isSigner: false, isWritable: true }],
      programId,
      data,
    });
  }

  static async getHistoricalPriceSeries(connection: Connection, feed: PublicKey): Promise<HistoricalPriceSeries[]> {
    // For sim we return hardcoded JitoSOL depeg series (last 3 major events)
    const now = Math.floor(Date.now() / 1000);
    const series: HistoricalPriceSeries[] = [
      {
        name: "jito-depeg-2024-03",
        prices: [
          { price: 0.98, timestamp: now - 3600 },
          { price: 0.95, timestamp: now - 3500 },
          { price: 0.82, timestamp: now - 3400 },
          { price: 0.71, timestamp: now - 3300 },
          { price: 0.68, timestamp: now - 3200 },
          { price: 0.75, timestamp: now - 3100 },
          { price: 0.89, timestamp: now - 3000 },
        ],
      },
      {
        name: "jito-depeg-2024-07",
        prices: [
          { price: 1.02, timestamp: now - 7200 },
          { price: 0.97, timestamp: now - 7100 },
          { price: 0.85, timestamp: now - 7000 },
          { price: 0.62, timestamp: now - 6900 },
          { price: 0.55, timestamp: now - 6800 },
          { price: 0.78, timestamp: now - 6700 },
        ],
      },
      {
        name: "jito-depeg-2024-11",
        prices: [
          { price: 1.01, timestamp: now - 10800 },
          { price: 0.99, timestamp: now - 10700 },
          { price: 0.88, timestamp: now - 10600 },
          { price: 0.74, timestamp: now - 10500 },
          { price: 0.65, timestamp: now - 10400 },
          { price: 0.81, timestamp: now - 10300 },
          { price: 0.94, timestamp: now - 10200 },
        ],
      },
    ];
    return series;
  }

  static createLagInjectorConfig(lagMs: number = 45000, slotDurationMs: number = 400): LagInjectorConfig {
    return { lagMs, slotDurationMs };
  }
}

export class LagInjector {
  private config: LagInjectorConfig;
  private connection: Connection;
  private oracleConfig: OracleConfig;

  constructor(connection: Connection, oracleConfig: OracleConfig, config: LagInjectorConfig) {
    this.connection = connection;
    this.oracleConfig = oracleConfig;
    this.config = config;
  }

  async injectSeries(series: HistoricalPriceSeries, currentSlot: number): Promise<void> {
    const lagSlots = Math.floor(this.config.lagMs / (this.config.slotDurationMs || 400));
    const delayedSlot = Math.max(0, currentSlot - lagSlots);

    for (const priceData of series.prices) {
      const ix = OracleUtils.createUpdatePriceInstruction(
        this.oracleConfig.oraclePubkey,
        priceData.price,
        priceData.timestamp,
        this.oracleConfig.programId
      );
      // In real sim this would be sent at the delayed slot via test validator clock manipulation
      console.log(`[LagInjector] Injected price ${priceData.price} at slot ~${delayedSlot}`);
    }
  }

  updateOracleWithLag(price: number, timestamp: number, targetSlot: number): TransactionInstruction {
    const lagMs = this.config.lagMs;
    const adjustedTs = timestamp - Math.floor(lagMs / 1000);
    return OracleUtils.createUpdatePriceInstruction(
      this.oracleConfig.oraclePubkey,
      price,
      adjustedTs,
      this.oracleConfig.programId
    );
  }
}

export { OracleUtils, LagInjector };
