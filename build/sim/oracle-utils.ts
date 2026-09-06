import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction, SystemProgram } from "@solana/web3.js";

export interface PriceData {
  price: number;
  confidence?: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  startSlot: number;
  endSlot: number;
}

export interface LagInjectorConfig {
  lagSlots: number;
  targetLagSeconds: number;
  oracleProgramId: PublicKey;
  oracleAccount: PublicKey;
}

export interface OracleConfig {
  lagSlots: number;
}

export class OracleUtils {
  static createUpdatePriceInstruction(
    oracleProgramId: PublicKey,
    oracleAccount: PublicKey,
    price: number,
    slot: number,
    payer: PublicKey
  ): TransactionInstruction {
    // Minimal placeholder instruction for the sim harness
    const data = Buffer.from([0, ...new Uint8Array(new Float64Array([price]).buffer)]);
    return new TransactionInstruction({
      keys: [
        { pubkey: oracleAccount, isSigner: false, isWritable: true },
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: oracleProgramId,
      data,
    });
  }

  static async getCurrentSlot(provider: anchor.AnchorProvider): Promise<number> {
    const slot = await provider.connection.getSlot();
    return slot;
  }

  static toPriceData(price: number): PriceData {
    return { price };
  }

  static createHistoricalSeries(prices: PriceData[], startSlot: number, endSlot: number): HistoricalPriceSeries {
    return { prices, startSlot, endSlot };
  }
}

export class LagInjector {
  private config: LagInjectorConfig;
  private provider: anchor.AnchorProvider;

  constructor(provider: anchor.AnchorProvider, config: LagInjectorConfig) {
    this.provider = provider;
    this.config = config;
  }

  async injectSeries(series: HistoricalPriceSeries): Promise<void> {
    // No-op for harness; real injection lives in tick-runner
  }

  async updateOracleWithLag(
    series: HistoricalPriceSeries,
    currentSlot: number,
    lagSlots: number
  ): Promise<void> {
    const effectiveIndex = Math.max(0, currentSlot - lagSlots - series.startSlot);
    if (effectiveIndex >= series.prices.length) return;

    const priceData = series.prices[effectiveIndex];
    const ix = OracleUtils.createUpdatePriceInstruction(
      this.config.oracleProgramId,
      this.config.oracleAccount,
      priceData.price,
      currentSlot,
      this.provider.wallet.publicKey
    );

    const tx = new anchor.web3.Transaction().add(ix);
    await this.provider.sendAndConfirm(tx);
  }
}

export function checkTWAPFalsePositive(
  series: HistoricalPriceSeries,
  twapWindowSlots: number = 150
): boolean {
  if (series.prices.length < 2) return false;

  const sum = series.prices.reduce((acc, p) => acc + p.price, 0);
  const avg = sum / series.prices.length;
  const last = series.prices[series.prices.length - 1].price;

  // Simple threshold for sim: flag as false-positive if TWAP and spot are within 5%
  return Math.abs((last - avg) / avg) < 0.05;
}
