import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair, TransactionInstruction, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import BN from "bn.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  startSlot: number;
  endSlot: number;
}

export interface LagInjectorConfig {
  lagMs: number;
  lagSlots: number;
  oraclePubkey: PublicKey;
  payer: Keypair;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  updateFrequencyMs: number;
}

export class OracleUtils {
  static createHistoricalPriceSeries(prices: PriceData[], startSlot: number = 0): HistoricalPriceSeries {
    const endSlot = startSlot + prices.length;
    return {
      prices,
      startSlot,
      endSlot,
    };
  }

  static getHistoricalPriceSeries(series: HistoricalPriceSeries, startIdx: number = 0, count?: number): PriceData[] {
    const end = count !== undefined ? startIdx + count : series.prices.length;
    return series.prices.slice(startIdx, end);
  }

  static createUpdatePriceInstruction(
    oraclePubkey: PublicKey,
    priceData: PriceData,
    payer: PublicKey
  ): TransactionInstruction {
    // Stub instruction for local test validator oracle (in real sim this would target a mock price account)
    const data = Buffer.from([
      1, // update discriminator
      ...new BN(Math.floor(priceData.price * 1_000_000)).toArray("le", 8),
      ...new BN(priceData.timestamp).toArray("le", 8),
    ]);

    return new TransactionInstruction({
      keys: [
        { pubkey: oraclePubkey, isSigner: false, isWritable: true },
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      ],
      programId: new PublicKey("11111111111111111111111111111111"), // mock oracle program
      data,
    });
  }

  static async advanceSlots(connection: Connection, slots: number): Promise<void> {
    const currentSlot = await connection.getSlot();
    await connection.requestAirdrop(Keypair.generate().publicKey, 0); // dummy to force slot advance in test validator
    // In practice test-validator automatically advances; here we simulate wait
    await new Promise((resolve) => setTimeout(resolve, slots * 50)); // rough 400ms/slot scaling
  }
}

export class LagInjector {
  private config: LagInjectorConfig;
  private series: HistoricalPriceSeries | null = null;
  private currentIndex: number = 0;

  constructor(config: LagInjectorConfig) {
    this.config = config;
  }

  injectSeries(series: HistoricalPriceSeries): void {
    this.series = series;
    this.currentIndex = 0;
  }

  async updateOracleWithLag(
    connection: Connection,
    provider: anchor.AnchorProvider,
    priceIndex: number
  ): Promise<void> {
    if (!this.series || priceIndex >= this.series.prices.length) {
      return;
    }

    const laggedIndex = Math.max(0, priceIndex - Math.floor(this.config.lagMs / 400)); // ~400ms per slot
    const priceData = this.series.prices[laggedIndex];

    const ix = OracleUtils.createUpdatePriceInstruction(
      this.config.oraclePubkey,
      priceData,
      this.config.payer.publicKey
    );

    const tx = new anchor.web3.Transaction().add(ix);
    await provider.sendAndConfirm(tx, [this.config.payer]);
    this.currentIndex = priceIndex;
  }

  getCurrentLagMs(): number {
    return this.config.lagMs;
  }

  getSeriesLength(): number {
    return this.series ? this.series.prices.length : 0;
  }

  getPriceAt(index: number): PriceData | null {
    if (!this.series || index < 0 || index >= this.series.prices.length) {
      return null;
    }
    return this.series.prices[index];
  }
}

export { OracleUtils as default };
