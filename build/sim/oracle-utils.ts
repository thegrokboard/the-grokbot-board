import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction, Connection, Keypair } from "@solana/web3.js";
import { BN } from "bn.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export class HistoricalPriceSeries {
  public readonly prices: PriceData[];
  public readonly startSlot: number;
  public readonly oraclePubkey: PublicKey;

  constructor(prices: PriceData[], startSlot: number, oraclePubkey: PublicKey) {
    this.prices = prices;
    this.startSlot = startSlot;
    this.oraclePubkey = oraclePubkey;
  }

  get length(): number {
    return this.prices.length;
  }

  filter(predicate: (price: PriceData, index: number) => boolean): PriceData[] {
    return this.prices.filter(predicate);
  }

  slice(start?: number, end?: number): PriceData[] {
    return this.prices.slice(start, end);
  }
}

export interface LagInjectorConfig {
  lagSlots: number;
  targetLagMs: number;
  oraclePubkey: PublicKey;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  lagSlots: number;
}

export class OracleUtils {
  private connection: Connection;
  private programId: PublicKey;

  constructor(connection: Connection, programId: PublicKey) {
    this.connection = connection;
    this.programId = programId;
  }

  createHistoricalPriceSeries(prices: PriceData[], startSlot: number, oraclePubkey: PublicKey): HistoricalPriceSeries {
    return new HistoricalPriceSeries(prices, startSlot, oraclePubkey);
  }

  async getHistoricalPriceSeries(oraclePubkey: PublicKey, limit: number = 1000): Promise<HistoricalPriceSeries> {
    // Simulated historical data for JitoSOL depeg replay (real implementation would query on-chain oracle)
    const now = Math.floor(Date.now() / 1000);
    const series: PriceData[] = [];
    for (let i = limit - 1; i >= 0; i--) {
      const price = 0.95 + (Math.sin(i / 10) * 0.08) + (Math.random() * 0.01); // simulate depeg around 0.9-1.0
      series.push({
        price: Math.max(0.85, Math.min(1.05, price)),
        timestamp: now - i * 15, // 15s ticks
      });
    }
    return new HistoricalPriceSeries(series.reverse(), 100000, oraclePubkey);
  }

  createUpdatePriceInstruction(
    oraclePubkey: PublicKey,
    price: number,
    timestamp: number,
    payer: PublicKey
  ): TransactionInstruction {
    // Mock instruction for test validator oracle update (in real harness this would target Switchboard or custom oracle program)
    const data = Buffer.from([0, ...new BN(price * 1_000_000).toArray("le", 8), ...new BN(timestamp).toArray("le", 8)]);
    return new TransactionInstruction({
      keys: [
        { pubkey: oraclePubkey, isSigner: false, isWritable: true },
        { pubkey: payer, isSigner: true, isWritable: true },
      ],
      programId: this.programId,
      data,
    });
  }

  async updateOracleWithLag(
    oraclePubkey: PublicKey,
    series: HistoricalPriceSeries,
    lagSlots: number,
    currentSlot: number,
    payer: Keypair
  ): Promise<void> {
    const effectiveIndex = Math.max(0, series.length - 1 - lagSlots);
    if (effectiveIndex >= series.length) return;

    const priceData = series.prices[effectiveIndex];
    const ix = this.createUpdatePriceInstruction(
      oraclePubkey,
      priceData.price,
      priceData.timestamp,
      payer.publicKey
    );

    const tx = await anchor.web3.sendAndConfirmTransaction(
      this.connection,
      new anchor.web3.Transaction().add(ix),
      [payer]
    );
    console.log(`Updated oracle ${oraclePubkey.toBase58()} with lagged price ${priceData.price} at slot ~${currentSlot}`);
  }
}

export class LagInjector {
  private oracleUtils: OracleUtils;
  private config: LagInjectorConfig;
  private injectedSeries: HistoricalPriceSeries[] = [];

  constructor(connection: Connection, programId: PublicKey, config: LagInjectorConfig) {
    this.oracleUtils = new OracleUtils(connection, programId);
    this.config = config;
  }

  async injectSeries(series: HistoricalPriceSeries): Promise<void> {
    this.injectedSeries.push(series);
    console.log(`Injected series of length ${series.length} with lag of ${this.config.lagSlots} slots`);
  }

  getSeries(): HistoricalPriceSeries[] {
    return this.injectedSeries;
  }

  async updateOracleWithLag(
    seriesIndex: number,
    currentSlot: number,
    payer: Keypair
  ): Promise<void> {
    if (seriesIndex >= this.injectedSeries.length) return;
    const series = this.injectedSeries[seriesIndex];
    await this.oracleUtils.updateOracleWithLag(
      this.config.oraclePubkey,
      series,
      this.config.lagSlots,
      currentSlot,
      payer
    );
  }
}

export function checkTWAPFalsePositive(series: HistoricalPriceSeries, windowSeconds: number = 15 * 60): boolean {
  if (series.prices.length < 2) return false;

  const recent = series.prices[series.prices.length - 1];
  const cutoff = recent.timestamp - windowSeconds;
  const windowPrices = series.prices.filter(p => p.timestamp >= cutoff);

  if (windowPrices.length < 4) return false;

  const sum = windowPrices.reduce((acc, p) => acc + p.price, 0);
  const twap = sum / windowPrices.length;

  // Simple false-positive heuristic: price dropped >8% but TWAP still >0.92 (typical JitoSOL depeg pattern)
  const lastPrice = recent.price;
  return lastPrice < 0.92 && twap > 0.925;
}
