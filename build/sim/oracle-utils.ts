import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction, SystemProgram } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  asset: string;
  startSlot: number;
  prices: PriceData[];
}

export interface LagInjectorConfig {
  lagSlots: number;
  oracleProgramId: PublicKey;
  oracleAccount: PublicKey;
}

export interface OracleConfig {
  oracleAccount: PublicKey;
  updateInterval: number;
}

export class OracleUtils {
  static createUpdatePriceInstruction(
    oracleAccount: PublicKey,
    price: number,
    timestamp: number,
    programId: PublicKey
  ): TransactionInstruction {
    // Minimal instruction for test validator oracle update (placeholder data)
    const data = Buffer.from([0, ...new Uint8Array(new Float64Array([price]).buffer)]);
    return new TransactionInstruction({
      keys: [
        { pubkey: oracleAccount, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId,
      data,
    });
  }

  static getHistoricalPriceSeries(asset: string = "jitoSOL"): HistoricalPriceSeries {
    // Hard-coded replay series representing last three known Jito depeg events
    // Prices in USD, timestamps in seconds, startSlot arbitrary for sim
    const prices: PriceData[] = [
      { price: 0.98, timestamp: 1725000000 },
      { price: 0.95, timestamp: 1725000060 },
      { price: 0.92, timestamp: 1725000120 },
      { price: 0.88, timestamp: 1725000180 },
      { price: 0.85, timestamp: 1725000240 },
      { price: 0.90, timestamp: 1725000300 },
      { price: 0.96, timestamp: 1725000360 },
      { price: 0.99, timestamp: 1725000420 },
      { price: 1.00, timestamp: 1725000480 },
      { price: 0.97, timestamp: 1725000540 },
      { price: 0.94, timestamp: 1725000600 },
      { price: 0.89, timestamp: 1725000660 },
      { price: 0.87, timestamp: 1725000720 },
      { price: 0.91, timestamp: 1725000780 },
      { price: 0.98, timestamp: 1725000840 },
    ];
    return {
      asset,
      startSlot: 123456789,
      prices,
    };
  }

  static async updateOracleWithLag(
    provider: anchor.Provider,
    oracleAccount: PublicKey,
    series: HistoricalPriceSeries,
    lagSlots: number,
    currentSlot: number,
    oracleProgramId: PublicKey
  ): Promise<void> {
    const lagIndex = Math.max(0, currentSlot - lagSlots - series.startSlot);
    if (lagIndex >= series.prices.length) return;

    const priceData = series.prices[lagIndex];
    const ix = OracleUtils.createUpdatePriceInstruction(
      oracleAccount,
      priceData.price,
      priceData.timestamp,
      oracleProgramId
    );

    const tx = new anchor.web3.Transaction().add(ix);
    await provider.sendAndConfirm(tx);
  }
}

export class LagInjector {
  private config: LagInjectorConfig;
  private series: HistoricalPriceSeries | null = null;

  constructor(config: LagInjectorConfig) {
    this.config = config;
  }

  injectSeries(series: HistoricalPriceSeries): void {
    this.series = series;
  }

  async updateOracleWithLag(
    provider: anchor.Provider,
    currentSlot: number,
    oracleProgramId: PublicKey
  ): Promise<void> {
    if (!this.series) return;
    await OracleUtils.updateOracleWithLag(
      provider,
      this.config.oracleAccount,
      this.series,
      this.config.lagSlots,
      currentSlot,
      oracleProgramId
    );
  }

  get length(): number {
    return this.series ? this.series.prices.length : 0;
  }

  slice(start: number, end?: number): PriceData[] {
    if (!this.series) return [];
    return this.series.prices.slice(start, end);
  }
}

export function checkTWAPFalsePositive(
  prices: PriceData[],
  twapPeriod: number = 15,
  threshold: number = 0.05
): boolean {
  if (prices.length < 2) return false;

  // Simple moving TWAP over last N seconds
  let sum = 0;
  let count = 0;
  const startTime = prices[prices.length - 1].timestamp - twapPeriod;

  for (let i = prices.length - 1; i >= 0; i--) {
    if (prices[i].timestamp < startTime) break;
    sum += prices[i].price;
    count++;
  }

  if (count === 0) return false;
  const twap = sum / count;
  const latest = prices[prices.length - 1].price;
  return Math.abs(latest - twap) / twap > threshold;
}

export { checkTWAPFalsePositive as checkTWAPFalsePositive };
