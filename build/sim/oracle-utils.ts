import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction, Connection } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  filter?: (p: PriceData) => boolean;
  length: number;
}

export interface LagInjectorConfig {
  lagMs: number;
  lagSlots?: number;
  oraclePubkey: PublicKey;
  priceFeedPubkey?: PublicKey;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  updateInterval: number;
}

export class OracleUtils {
  static createUpdatePriceInstruction(
    oraclePubkey: PublicKey,
    price: number,
    timestamp: number,
    confidence?: number
  ): TransactionInstruction {
    // Placeholder for real oracle update (e.g. Switchboard or custom); in sim we just log intent
    const data = Buffer.from(
      JSON.stringify({ price, timestamp, confidence: confidence || 0.01 })
    );
    return new TransactionInstruction({
      keys: [{ pubkey: oraclePubkey, isSigner: false, isWritable: true }],
      programId: new PublicKey("11111111111111111111111111111111"),
      data,
    });
  }

  static async getHistoricalPriceSeries(
    connection: Connection,
    feedPubkey: PublicKey,
    limit: number = 1000
  ): Promise<HistoricalPriceSeries> {
    // In test validator sim we return a deterministic JitoSOL depeg series (3 real past depegs approximated)
    const now = Math.floor(Date.now() / 1000);
    const basePrices: PriceData[] = [
      { price: 0.92, timestamp: now - 3600 * 24 * 7 },
      { price: 0.89, timestamp: now - 3600 * 24 * 6 },
      { price: 0.85, timestamp: now - 3600 * 24 * 5 },
      { price: 0.78, timestamp: now - 3600 * 24 * 4 },
      { price: 0.95, timestamp: now - 3600 * 24 * 3 },
      { price: 1.02, timestamp: now - 3600 * 24 * 2 },
      { price: 0.99, timestamp: now - 3600 * 24 },
      { price: 0.88, timestamp: now - 3600 * 12 },
      { price: 0.75, timestamp: now - 3600 * 6 },
      { price: 0.68, timestamp: now - 3600 * 3 },
      { price: 0.95, timestamp: now - 1800 },
      { price: 1.01, timestamp: now - 900 },
    ];
    const series: HistoricalPriceSeries = {
      prices: basePrices.slice(-limit),
      length: basePrices.length,
    };
    return series;
  }

  static createHistoricalPriceSeries(prices: PriceData[]): HistoricalPriceSeries {
    return {
      prices,
      length: prices.length,
    };
  }
}

export class LagInjector {
  private config: LagInjectorConfig;
  private connection: Connection;
  private injected: Map<number, PriceData> = new Map();

  constructor(connection: Connection, config: LagInjectorConfig) {
    this.connection = connection;
    this.config = config;
  }

  async injectSeries(series: HistoricalPriceSeries, slotOffset: number = 0): Promise<void> {
    for (let i = 0; i < series.prices.length; i++) {
      const p = series.prices[i];
      const laggedTs = p.timestamp + Math.floor(this.config.lagMs / 1000);
      this.injected.set(laggedTs, { price: p.price, timestamp: laggedTs });
      const ix = OracleUtils.createUpdatePriceInstruction(
        this.config.oraclePubkey,
        p.price,
        laggedTs
      );
      // In sim we don't actually send; tick-runner drives real txs
    }
  }

  async updateOracleWithLag(price: number, timestamp: number): Promise<void> {
    const laggedTs = timestamp + Math.floor(this.config.lagMs / 1000);
    const ix = OracleUtils.createUpdatePriceInstruction(
      this.config.oraclePubkey,
      price,
      laggedTs
    );
    this.injected.set(laggedTs, { price, timestamp: laggedTs });
    // Real send would happen in runner using provider
  }

  getPriceAt(ts: number): PriceData | null {
    return this.injected.get(ts) || null;
  }
}

export function checkTWAPFalsePositive(
  series: HistoricalPriceSeries,
  windowSeconds: number = 15,
  threshold: number = 0.05
): boolean {
  if (series.prices.length < 2) return false;
  const sorted = [...series.prices].sort((a, b) => a.timestamp - b.timestamp);
  const end = sorted[sorted.length - 1];
  const windowStart = end.timestamp - windowSeconds;
  const windowPrices = sorted.filter(p => p.timestamp >= windowStart);
  if (windowPrices.length < 2) return false;
  const avg = windowPrices.reduce((sum, p) => sum + p.price, 0) / windowPrices.length;
  const last = windowPrices[windowPrices.length - 1].price;
  return Math.abs(last - avg) / avg > threshold;
}

// Export for backward compatibility used by tick-runner
export const getHistoricalPriceSeries = OracleUtils.getHistoricalPriceSeries;
export { OracleUtils };
