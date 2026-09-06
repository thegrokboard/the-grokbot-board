import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  mint: PublicKey;
}

export interface LagInjectorConfig {
  lagSlots: number;
  targetLagMs: number;
  oracleProgramId: PublicKey;
  oracleAccount: PublicKey;
}

export interface OracleConfig {
  oracleProgramId: PublicKey;
  oracleAccount: PublicKey;
  lagSlots: number;
}

export class OracleUtils {
  private connection: anchor.web3.Connection;
  private programId: PublicKey;

  constructor(connection: anchor.web3.Connection, programId: PublicKey) {
    this.connection = connection;
    this.programId = programId;
  }

  static createUpdatePriceInstruction(
    oracleAccount: PublicKey,
    price: number,
    timestamp: number,
    oracleProgramId: PublicKey
  ): TransactionInstruction {
    // Minimal placeholder matching the expected call sites.
    // In a full harness this would build a real Switchboard / custom oracle IX.
    const data = Buffer.from([0, ...new Uint8Array(new Float64Array([price]).buffer)]);
    return new TransactionInstruction({
      keys: [{ pubkey: oracleAccount, isSigner: false, isWritable: true }],
      programId: oracleProgramId,
      data,
    });
  }

  async getLatestPrice(oracleAccount: PublicKey): Promise<PriceData> {
    // Stub for test-validator simulation
    const slot = await this.connection.getSlot();
    return {
      price: 0.95,
      timestamp: Date.now() - 1000 * 30,
    };
  }

  async getHistoricalPriceSeries(
    oracleAccount: PublicKey,
    limit: number = 100
  ): Promise<HistoricalPriceSeries> {
    const now = Math.floor(Date.now() / 1000);
    const prices: PriceData[] = [];
    for (let i = limit - 1; i >= 0; i--) {
      prices.push({
        price: 0.92 + Math.random() * 0.15,
        timestamp: now - i * 15,
      });
    }
    return {
      prices,
      mint: oracleAccount,
    };
  }
}

export function checkTWAPFalsePositive(
  series: HistoricalPriceSeries,
  twapPeriodSlots: number = 60,
  threshold: number = 0.05
): boolean {
  if (series.prices.length < 2) return false;
  const prices = series.prices;
  const sum = prices.reduce((acc, p) => acc + p.price, 0);
  const twap = sum / prices.length;
  const latest = prices[prices.length - 1].price;
  return Math.abs(latest - twap) / twap < threshold;
}

export async function simulateLag(
  series: HistoricalPriceSeries,
  lagSlots: number
): Promise<PriceData> {
  if (series.prices.length === 0) {
    throw new Error("Empty price series");
  }
  const idx = Math.max(0, series.prices.length - 1 - lagSlots);
  return series.prices[idx];
}
