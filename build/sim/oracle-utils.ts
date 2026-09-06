import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, TransactionInstruction, Keypair } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  oracle: PublicKey;
}

export interface LagInjectorConfig {
  lagSlots: number;
  targetLagMs: number;
  series: HistoricalPriceSeries[];
}

export interface OracleConfig {
  oracle: PublicKey;
  owner: PublicKey;
  updateAuthority: PublicKey;
}

export class LagInjector {
  private config: LagInjectorConfig;
  private connection: Connection;
  private wallet: anchor.Wallet;

  constructor(config: LagInjectorConfig, connection: Connection, wallet: anchor.Wallet) {
    this.config = config;
    this.connection = connection;
    this.wallet = wallet;
  }

  async injectSeries(seriesIndex: number): Promise<void> {
    const series = this.config.series[seriesIndex];
    if (!series) throw new Error("Series not found");
    for (const price of series.prices) {
      await this.updateOracleWithLag(series.oracle, price.price, price.timestamp);
    }
  }

  async updateOracleWithLag(oracle: PublicKey, price: number, timestamp: number): Promise<void> {
    const ix = OracleUtils.createUpdatePriceInstruction(oracle, price, timestamp, this.wallet.publicKey);
    const tx = new anchor.web3.Transaction().add(ix);
    await anchor.web3.sendAndConfirmTransaction(this.connection, tx, [this.wallet.payer]);
  }

  getHistoricalPriceSeries(oracle: PublicKey, prices: PriceData[]): HistoricalPriceSeries {
    return { oracle, prices };
  }

  static createLagInjectorConfig(
    lagSlots: number,
    targetLagMs: number,
    series: HistoricalPriceSeries[]
  ): LagInjectorConfig {
    return { lagSlots, targetLagMs, series };
  }
}

export class OracleUtils {
  static createUpdatePriceInstruction(
    oracle: PublicKey,
    price: number,
    timestamp: number,
    updater: PublicKey
  ): TransactionInstruction {
    // Placeholder for a real oracle update instruction (e.g. Switchboard, Pyth, or custom)
    // In the real harness this would build the correct CPI or direct ix; here we use a no-op
    // that passes type checks and runtime on test validator.
    const data = Buffer.from([1, ...new Uint8Array(new Float64Array([price]).buffer), timestamp]);
    return new TransactionInstruction({
      keys: [
        { pubkey: oracle, isSigner: false, isWritable: true },
        { pubkey: updater, isSigner: true, isWritable: false },
      ],
      programId: new PublicKey("11111111111111111111111111111111"),
      data,
    });
  }

  static createHistoricalPriceSeries(oracle: PublicKey, prices: PriceData[]): HistoricalPriceSeries {
    return { oracle, prices };
  }

  static async createOracleAccount(
    connection: Connection,
    payer: Keypair,
    owner: PublicKey
  ): Promise<PublicKey> {
    const oracle = Keypair.generate();
    // In a full harness we would allocate and initialize an oracle account here.
    // For sim harness we simply return a fresh key so that the injector can write to it.
    return oracle.publicKey;
  }
}

export function checkTWAPFalsePositive(
  series: HistoricalPriceSeries,
  twapPeriodSeconds: number,
  thresholdBps: number
): boolean {
  if (series.prices.length < 2) return false;
  const sorted = [...series.prices].sort((a, b) => a.timestamp - b.timestamp);
  const now = sorted[sorted.length - 1].timestamp;
  const cutoff = now - twapPeriodSeconds;

  let sum = 0;
  let count = 0;
  for (const p of sorted) {
    if (p.timestamp >= cutoff) {
      sum += p.price;
      count++;
    }
  }
  if (count === 0) return false;
  const twap = sum / count;
  const latest = sorted[sorted.length - 1].price;
  const diffBps = Math.abs(latest - twap) * 10000 / twap;
  return diffBps > thresholdBps;
}

// Re-export for convenience
export { OracleUtils };
