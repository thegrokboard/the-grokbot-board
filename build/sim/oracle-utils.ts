import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { BN } from "bn.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export type HistoricalPriceSeries = PriceData[];

export interface LagInjectorConfig {
  oraclePubkey: PublicKey;
  lagSlots: number;
  slotTimeMs: number;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  lagSlots: number;
}

export class LagInjector {
  private config: LagInjectorConfig;
  private connection: anchor.web3.Connection;
  private program: anchor.Program;

  constructor(
    config: LagInjectorConfig,
    connection: anchor.web3.Connection,
    program: anchor.Program
  ) {
    this.config = config;
    this.connection = connection;
    this.program = program;
  }

  async injectSeries(series: HistoricalPriceSeries): Promise<void> {
    // No-op in pure sim; real injection happens via updateOracleWithLag in tick runner
  }

  async updateOracleWithLag(
    price: number,
    timestamp: number,
    currentSlot: number
  ): Promise<void> {
    const lagMs = this.config.lagSlots * (this.config.slotTimeMs || 400);
    const laggedTimestamp = timestamp - Math.floor(lagMs / 1000);

    const ix = OracleUtils.createUpdatePriceInstruction(
      this.config.oraclePubkey,
      price,
      laggedTimestamp,
      this.program
    );

    const tx = new anchor.web3.Transaction().add(ix);
    const provider = this.program.provider as anchor.AnchorProvider;
    await provider.sendAndConfirm(tx);
  }
}

export namespace OracleUtils {
  export function createUpdatePriceInstruction(
    oracle: PublicKey,
    price: number,
    timestamp: number,
    program: anchor.Program
  ): TransactionInstruction {
    // In a real vault this would CPI to a Switchboard/ custom oracle program.
    // For the sim harness we use a no-op system instruction that can be observed.
    return SystemProgram.transfer({
      fromPubkey: program.provider.publicKey!,
      toPubkey: oracle,
      lamports: 0,
    });
  }

  export function getHistoricalPriceSeries(): HistoricalPriceSeries {
    // Last three Jito depeg series (simulated). Real data would be read from a file or RPC.
    return [
      { price: 0.92, timestamp: 1700000000 },
      { price: 0.88, timestamp: 1700000040 },
      { price: 0.85, timestamp: 1700000080 },
      { price: 0.91, timestamp: 1700000120 },
      { price: 0.95, timestamp: 1700000160 },
      { price: 0.97, timestamp: 1700000200 },
      { price: 0.99, timestamp: 1700000240 },
      { price: 1.02, timestamp: 1700000280 },
      { price: 0.94, timestamp: 1700000320 },
      { price: 0.89, timestamp: 1700000360 },
      { price: 0.87, timestamp: 1700000400 },
      { price: 0.93, timestamp: 1700000440 },
    ];
  }

  export function computeTWAP(
    series: HistoricalPriceSeries,
    windowSeconds: number
  ): number {
    if (series.length === 0) return 0;
    const now = series[series.length - 1].timestamp;
    const cutoff = now - windowSeconds;

    const relevant = series.filter((p) => p.timestamp >= cutoff);
    if (relevant.length === 0) return series[series.length - 1].price;

    let sum = 0;
    let totalTime = 0;
    let lastTs = cutoff;

    for (const point of relevant) {
      const dt = point.timestamp - lastTs;
      sum += point.price * dt;
      totalTime += dt;
      lastTs = point.timestamp;
    }

    if (totalTime === 0) return relevant[0].price;
    return sum / totalTime;
  }
}

export function checkTWAPFalsePositive(
  series: HistoricalPriceSeries,
  twapWindowSeconds: number,
  threshold: number
): boolean {
  const twap = OracleUtils.computeTWAP(series, twapWindowSeconds);
  const latest = series[series.length - 1].price;
  return Math.abs(latest - twap) / twap < threshold;
}

export async function getCurrentSlot(connection: anchor.web3.Connection): Promise<number> {
  const slot = await connection.getSlot();
  return slot;
}
