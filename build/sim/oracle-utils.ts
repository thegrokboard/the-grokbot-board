import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction, Connection } from "@solana/web3.js";
import { BN } from "bn.js";

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
  lagSlots: number;
  targetLagMs: number;
  oraclePubkey: PublicKey;
  jitoSolMint: PublicKey;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  updateFrequency: number;
  lagSlots: number;
}

export interface TWAPConfig {
  windowSlots: number;
  thresholdBps: number;
}

export interface VaultState {
  owner: PublicKey;
  paused: boolean;
  protectionBuffer: BN;
  lastDrawdownSlot: number;
  jitoSolVault: PublicKey;
}

export class OracleUtils {
  static createUpdatePriceInstruction(
    oraclePubkey: PublicKey,
    price: number,
    slot: number,
    programId: PublicKey
  ): TransactionInstruction {
    // Minimal placeholder for test-validator oracle update (in real sim this would target a mock oracle program)
    return new TransactionInstruction({
      keys: [{ pubkey: oraclePubkey, isSigner: false, isWritable: true }],
      programId,
      data: Buffer.from([0, ...new BN(price).toArray("le", 8), ...new BN(slot).toArray("le", 8)]),
    });
  }

  static async getHistoricalPriceSeries(
    connection: Connection,
    oraclePubkey: PublicKey,
    numSeries: number = 3
  ): Promise<HistoricalPriceSeries[]> {
    // In test sim we return deterministic depeg series; real implementation would read from on-chain history or fixture
    const series: HistoricalPriceSeries[] = [];
    const baseSlot = 100_000;
    for (let i = 0; i < numSeries; i++) {
      const prices: PriceData[] = [];
      for (let j = 0; j < 50; j++) {
        const price = 0.95 + (i * 0.03) + Math.sin(j / 5) * 0.05; // mild depeg + oscillation
        prices.push({
          price: Math.max(price, 0.8),
          timestamp: Date.now() - (50 - j) * 15000,
        });
      }
      series.push({
        prices,
        startSlot: baseSlot + i * 1000,
        endSlot: baseSlot + i * 1000 + 2000,
      });
    }
    return series;
  }

  static calculateTWAP(prices: PriceData[], windowMs: number): number {
    if (prices.length === 0) return 0;
    const now = Date.now();
    const windowStart = now - windowMs;
    const relevant = prices.filter((p) => p.timestamp >= windowStart);
    if (relevant.length === 0) return prices[prices.length - 1].price;
    const sum = relevant.reduce((acc, p) => acc + p.price, 0);
    return sum / relevant.length;
  }
}

export class LagInjector {
  private config: LagInjectorConfig;
  private connection: Connection;
  private programId: PublicKey;

  constructor(config: LagInjectorConfig, connection: Connection, programId: PublicKey) {
    this.config = config;
    this.connection = connection;
    this.programId = programId;
  }

  async injectSeries(series: HistoricalPriceSeries): Promise<void> {
    for (const price of series.prices) {
      const ix = OracleUtils.createUpdatePriceInstruction(
        this.config.oraclePubkey,
        price.price,
        Math.floor(Date.now() / 400) + this.config.lagSlots,
        this.programId
      );
      // In a real test harness we would send via provider; here we simulate for CI
      console.log(`Injected lagged price ${price.price} at slot offset ${this.config.lagSlots}`);
    }
  }

  async updateOracleWithLag(price: number, slot: number): Promise<void> {
    const ix = OracleUtils.createUpdatePriceInstruction(
      this.config.oraclePubkey,
      price,
      slot,
      this.programId
    );
    console.log(`Updated oracle with lag for price ${price}`);
  }
}

export function checkTWAPFalsePositive(
  series: HistoricalPriceSeries,
  twapConfig: TWAPConfig,
  currentPrice: number
): boolean {
  const twap = OracleUtils.calculateTWAP(series.prices, twapConfig.windowSlots * 400); // ~400ms per slot
  const diffBps = Math.abs((twap - currentPrice) / currentPrice) * 10000;
  return diffBps < twapConfig.thresholdBps;
}

// Re-export for convenience
export { OracleUtils, LagInjector };
