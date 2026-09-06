import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  name: string;
}

export interface LagInjectorConfig {
  lagMs: number;
  lagSlots: number;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  feedName: string;
}

export class OracleUtils {
  static getHistoricalPriceSeries(): HistoricalPriceSeries[] {
    // Replay of last three JitoSOL depeg events (synthetic but realistic)
    return [
      {
        name: "jito-depeg-1",
        prices: [
          { price: 1.02, timestamp: 0 },
          { price: 0.98, timestamp: 15 },
          { price: 0.85, timestamp: 45 },
          { price: 0.72, timestamp: 90 },
          { price: 0.68, timestamp: 150 },
          { price: 0.75, timestamp: 210 },
          { price: 0.91, timestamp: 300 },
        ],
      },
      {
        name: "jito-depeg-2",
        prices: [
          { price: 1.01, timestamp: 0 },
          { price: 0.95, timestamp: 30 },
          { price: 0.81, timestamp: 60 },
          { price: 0.79, timestamp: 120 },
          { price: 0.88, timestamp: 200 },
          { price: 0.97, timestamp: 280 },
        ],
      },
      {
        name: "jito-depeg-3",
        prices: [
          { price: 1.00, timestamp: 0 },
          { price: 0.89, timestamp: 20 },
          { price: 0.77, timestamp: 55 },
          { price: 0.65, timestamp: 100 },
          { price: 0.71, timestamp: 160 },
          { price: 0.84, timestamp: 240 },
          { price: 0.96, timestamp: 310 },
        ],
      },
    ];
  }

  static createLagInjectorConfig(lagMs: number = 45000, lagSlots: number = 90): LagInjectorConfig {
    return { lagMs, lagSlots };
  }

  static createOracleConfig(oraclePubkey: PublicKey, feedName: string = "jitoSOL"): OracleConfig {
    return { oraclePubkey, feedName };
  }

  static createUpdatePriceInstruction(
    oraclePubkey: PublicKey,
    priceData: PriceData,
    programId: PublicKey
  ): TransactionInstruction {
    // Minimal instruction for test-validator oracle update (mock CPI target)
    const data = Buffer.from(
      Uint8Array.from([
        0, // discriminator for update
        ...new anchor.BN(Math.floor(priceData.price * 1e9)).toArray("le", 8),
        ...new anchor.BN(priceData.timestamp).toArray("le", 8),
      ])
    );
    return new TransactionInstruction({
      keys: [{ pubkey: oraclePubkey, isSigner: false, isWritable: true }],
      programId,
      data,
    });
  }

  static async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export class LagInjector {
  private config: LagInjectorConfig;
  private oracleUtils: typeof OracleUtils;
  private series: HistoricalPriceSeries[] = [];

  constructor(config: LagInjectorConfig) {
    this.config = config;
    this.oracleUtils = OracleUtils;
  }

  injectSeries(series: HistoricalPriceSeries[]): void {
    this.series = series;
  }

  getHistoricalPriceSeries(): HistoricalPriceSeries[] {
    return this.series;
  }

  async updateOracleWithLag(
    price: PriceData,
    oraclePubkey: PublicKey,
    provider: anchor.AnchorProvider,
    programId: PublicKey
  ): Promise<void> {
    const laggedTime = price.timestamp * 1000 + this.config.lagMs;
    await this.oracleUtils.sleep(this.config.lagMs);
    const ix = this.oracleUtils.createUpdatePriceInstruction(
      oraclePubkey,
      { price: price.price, timestamp: Math.floor(laggedTime / 1000) },
      programId
    );
    const tx = new anchor.web3.Transaction().add(ix);
    await provider.sendAndConfirm(tx);
  }
}

export function checkTWAPFalsePositive(prices: PriceData[], windowSeconds: number = 15 * 60): boolean {
  if (prices.length < 2) return false;
  const now = prices[prices.length - 1].timestamp;
  const windowStart = now - windowSeconds;
  const windowPrices = prices.filter((p) => p.timestamp >= windowStart);
  if (windowPrices.length < 2) return false;

  let sum = 0;
  for (const p of windowPrices) {
    sum += p.price;
  }
  const twap = sum / windowPrices.length;
  // False positive if TWAP > 0.90 (did not actually breach protection buffer threshold)
  return twap > 0.90;
}

export { checkTWAPFalsePositive as checkTWAP };
export { OracleUtils, LagInjector };
