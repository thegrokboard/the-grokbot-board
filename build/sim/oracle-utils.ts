import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { OracleConfig } from "../programs/vault/target/types/vault"; // Align with program IDL if needed, but minimal for sim

export interface PriceData {
  price: number; // in USD, scaled or raw as per series
  timestamp: number; // unix ms
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  asset: string;
  startSlot: number;
  endSlot: number;
}

export interface LagInjectorConfig {
  lagMs: number; // target 45000
  slotLag: number;
  oraclePubkey: PublicKey;
  priceFeedPubkey?: PublicKey;
  jitoSolMint: PublicKey;
}

export interface OracleUtils {
  getHistoricalPriceSeries: (asset: string, startSlot: number, endSlot: number) => Promise<HistoricalPriceSeries>;
  createLagInjectorConfig: (oraclePubkey: PublicKey, lagMs?: number) => LagInjectorConfig;
}

export const OracleUtils: OracleUtils = {
  async getHistoricalPriceSeries(
    asset: string,
    startSlot: number,
    endSlot: number
  ): Promise<HistoricalPriceSeries> {
    // Minimal stub returning last 3 Jito depeg series (hardcoded for sim replay)
    // In full version would fetch from onchain history or fixture
    const now = Date.now();
    return {
      asset,
      startSlot,
      endSlot,
      prices: [
        { price: 0.92, timestamp: now - 180000 },
        { price: 0.85, timestamp: now - 120000 },
        { price: 0.78, timestamp: now - 60000 },
        { price: 0.95, timestamp: now - 30000 },
        { price: 0.99, timestamp: now },
      ],
    };
  },

  createLagInjectorConfig(oraclePubkey: PublicKey, lagMs: number = 45000): LagInjectorConfig {
    return {
      lagMs,
      slotLag: Math.floor(lagMs / 400), // ~400ms per slot
      oraclePubkey,
      jitoSolMint: new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"), // JitoSOL mint
    };
  },
};

export class LagInjector {
  private config: LagInjectorConfig;
  private connection: Connection;
  private provider: anchor.AnchorProvider;
  private lastInjected: Map<string, PriceData> = new Map();

  constructor(provider: anchor.AnchorProvider, config: LagInjectorConfig) {
    this.provider = provider;
    this.connection = provider.connection;
    this.config = config;
  }

  async injectSeries(series: HistoricalPriceSeries): Promise<void> {
    for (const price of series.prices) {
      await this.updateOracleWithLag(price);
    }
  }

  async updateOracleWithLag(priceData: PriceData): Promise<void> {
    const laggedTime = priceData.timestamp + this.config.lagMs;
    const now = Date.now();
    if (laggedTime > now) {
      const waitMs = laggedTime - now;
      await new Promise((r) => setTimeout(r, waitMs));
    }

    // Simulate oracle update (in real sim: call Switchboard or Pyth update ix)
    // For pure-onchain test-validator, we just log and store for TWAP
    this.lastInjected.set(this.config.oraclePubkey.toString(), {
      price: priceData.price,
      timestamp: laggedTime,
    });

    console.log(`[LagInjector] Updated oracle with lagged price: ${priceData.price} at slot ~${Math.floor(laggedTime / 400)}`);
  }

  getLatestPrice(): PriceData | null {
    const key = this.config.oraclePubkey.toString();
    return this.lastInjected.get(key) || null;
  }
}

export function createLagInjector(
  provider: anchor.AnchorProvider,
  config: LagInjectorConfig
): LagInjector {
  return new LagInjector(provider, config);
}

export async function checkTWAPFalsePositive(
  series: HistoricalPriceSeries,
  twapWindowMs: number = 15000
): Promise<boolean> {
  if (series.prices.length < 2) return false;

  const now = Date.now();
  const windowStart = now - twapWindowMs;

  const recent = series.prices.filter((p) => p.timestamp >= windowStart);
  if (recent.length < 2) return false;

  const sum = recent.reduce((acc, p) => acc + p.price, 0);
  const twap = sum / recent.length;

  // JitoSOL depeg false-positive threshold (e.g. >5% drawdown triggers breaker)
  const depegThreshold = 0.92; // 8% drawdown
  const isFalsePositive = twap > depegThreshold && recent[recent.length - 1].price < depegThreshold * 0.95;

  console.log(`[TWAPChecker] TWAP=${twap.toFixed(4)}, latest=${recent[recent.length - 1].price.toFixed(4)}, falsePositive=${isFalsePositive}`);
  return isFalsePositive;
}

// Re-export for compatibility with committed files
export { checkTWAPFalsePositive as checkTWAPFalsePositive };
export { HistoricalPriceSeries, PriceData, LagInjectorConfig };
export { getHistoricalPriceSeries } from "./oracle-utils"; // self-consistent
