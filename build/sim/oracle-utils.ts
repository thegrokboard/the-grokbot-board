import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction, Connection, Keypair } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  feed: PublicKey;
}

export interface LagInjectorConfig {
  lagSlots: number;
  targetLagMs: number;
  oracleFeed: PublicKey;
  jitoSolMint: PublicKey;
}

export interface OracleConfig {
  oracleFeed: PublicKey;
  updateFrequency: number;
  lagSlots?: number;
}

export class OracleUtils {
  private connection: Connection;
  private programId: PublicKey;

  constructor(connection: Connection, programId: PublicKey) {
    this.connection = connection;
    this.programId = programId;
  }

  static createLagInjectorConfig(
    oracleFeed: PublicKey,
    jitoSolMint: PublicKey,
    lagSlots: number = 180,
    targetLagMs: number = 45000
  ): LagInjectorConfig {
    return {
      lagSlots,
      targetLagMs,
      oracleFeed,
      jitoSolMint,
    };
  }

  createLagInjector(config: LagInjectorConfig): LagInjector {
    return new LagInjector(this.connection, config);
  }

  async getHistoricalPriceSeries(
    feed: PublicKey,
    numPrices: number = 300
  ): Promise<HistoricalPriceSeries> {
    // Simulate historical JitoSOL depeg series (real data would be fetched from Pyth/Switchboard)
    const now = Math.floor(Date.now() / 1000);
    const prices: PriceData[] = [];
    let basePrice = 0.95; // start below peg
    for (let i = 0; i < numPrices; i++) {
      const deviation = Math.sin(i / 30) * 0.08 + (i > 150 ? 0.12 : 0);
      const price = Math.max(0.82, Math.min(1.05, basePrice + deviation));
      prices.push({
        price: parseFloat(price.toFixed(6)),
        timestamp: now - (numPrices - i) * 15,
      });
      basePrice = price;
    }
    return { prices: prices.reverse(), feed };
  }

  createUpdatePriceInstruction(
    feed: PublicKey,
    price: number,
    timestamp: number,
    payer: PublicKey
  ): TransactionInstruction {
    // Stub instruction for test validator simulation
    const data = Buffer.from(
      anchor.utils.bytes.utf8.encode(
        JSON.stringify({ price, timestamp, feed: feed.toBase58() })
      )
    );
    return new TransactionInstruction({
      keys: [
        { pubkey: feed, isSigner: false, isWritable: true },
        { pubkey: payer, isSigner: true, isWritable: true },
      ],
      programId: this.programId,
      data,
    });
  }
}

export class LagInjector {
  private connection: Connection;
  private config: LagInjectorConfig;
  private injectedSeries: HistoricalPriceSeries | null = null;

  constructor(connection: Connection, config: LagInjectorConfig) {
    this.connection = connection;
    this.config = config;
  }

  async injectSeries(series: HistoricalPriceSeries): Promise<void> {
    this.injectedSeries = series;
    console.log(`[LagInjector] Injected series of ${series.prices.length} prices with ${this.config.lagSlots} slot lag`);
  }

  async updateOracleWithLag(
    provider: anchor.AnchorProvider,
    currentSlot: number,
    priceIndex: number
  ): Promise<boolean> {
    if (!this.injectedSeries || priceIndex >= this.injectedSeries.prices.length) {
      return false;
    }

    const laggedIndex = Math.max(0, priceIndex - Math.floor(this.config.lagSlots / 4));
    const priceData = this.injectedSeries.prices[laggedIndex];
    const oracleFeed = this.config.oracleFeed;

    try {
      const ix = new OracleUtils(this.connection, this.config.oracleFeed).createUpdatePriceInstruction(
        oracleFeed,
        priceData.price,
        priceData.timestamp,
        provider.wallet.publicKey
      );

      const tx = new anchor.web3.Transaction().add(ix);
      await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
      console.log(`[LagInjector] Updated oracle at slot ${currentSlot} with lagged price $${priceData.price}`);
      return true;
    } catch (err) {
      console.error("[LagInjector] Update failed:", err);
      return false;
    }
  }

  getCurrentLag(): number {
    return this.config.lagSlots;
  }
}

// Export utilities for direct use
export function checkTWAPFalsePositive(prices: PriceData[], windowSlots: number = 300): boolean {
  if (prices.length < 4) return false;
  const recent = prices.slice(-4);
  const avg = recent.reduce((sum, p) => sum + p.price, 0) / recent.length;
  const last = recent[recent.length - 1].price;
  return Math.abs(last - avg) / avg < 0.015; // <1.5% deviation from 15s TWAP
}

export const createOracleUtils = (connection: Connection, programId: PublicKey) => {
  return new OracleUtils(connection, programId);
};
