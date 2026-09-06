import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export type HistoricalPriceSeries = PriceData[];

export interface LagInjectorConfig {
  lagMs: number;
  lagSlots: number;
  oraclePubkey: PublicKey;
  jitoSolMint: PublicKey;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  updateFrequencyMs: number;
}

export interface TWAPConfig {
  windowMs: number;
  thresholdBps: number;
}

export interface VaultState {
  owner: PublicKey;
  paused: boolean;
  bufferAmount: anchor.BN;
  lastDrawdownCheck: anchor.BN;
}

export namespace OracleUtils {
  export function createLagInjectorConfig(
    lagMs: number,
    lagSlots: number,
    oraclePubkey: PublicKey,
    jitoSolMint: PublicKey
  ): LagInjectorConfig {
    return { lagMs, lagSlots, oraclePubkey, jitoSolMint };
  }

  export function createOracleConfig(oraclePubkey: PublicKey): OracleConfig {
    return {
      oraclePubkey,
      updateFrequencyMs: 15000,
    };
  }

  export function createTWAPConfig(): TWAPConfig {
    return {
      windowMs: 15000,
      thresholdBps: 500,
    };
  }

  export function createMockJitoDepegSeries(): HistoricalPriceSeries[] {
    const now = Math.floor(Date.now() / 1000);
    const series1: HistoricalPriceSeries = [
      { price: 1.00, timestamp: now - 180 },
      { price: 0.98, timestamp: now - 120 },
      { price: 0.95, timestamp: now - 60 },
      { price: 0.82, timestamp: now },
    ];
    const series2: HistoricalPriceSeries = [
      { price: 1.00, timestamp: now - 200 },
      { price: 0.99, timestamp: now - 140 },
      { price: 0.97, timestamp: now - 80 },
      { price: 0.91, timestamp: now - 20 },
    ];
    const series3: HistoricalPriceSeries = [
      { price: 1.00, timestamp: now - 170 },
      { price: 0.85, timestamp: now - 110 },
      { price: 0.78, timestamp: now - 50 },
      { price: 0.75, timestamp: now },
    ];
    return [series1, series2, series3];
  }

  export function getHistoricalPriceSeries(
    config: LagInjectorConfig
  ): HistoricalPriceSeries[] {
    return createMockJitoDepegSeries();
  }

  export function calculateTWAP(series: HistoricalPriceSeries, windowMs: number): number {
    if (series.length === 0) return 0;
    const now = Date.now();
    const cutoff = now - windowMs;
    const relevant = series.filter((p) => p.timestamp * 1000 >= cutoff);
    if (relevant.length === 0) return series[series.length - 1].price;
    const sum = relevant.reduce((acc, p) => acc + p.price, 0);
    return sum / relevant.length;
  }
}

export class LagInjector {
  private config: LagInjectorConfig;
  private injected: Map<string, HistoricalPriceSeries> = new Map();

  constructor(config: LagInjectorConfig) {
    this.config = config;
  }

  public injectSeries(series: HistoricalPriceSeries, oracleKey: string): void {
    this.injected.set(oracleKey, [...series]);
  }

  public getSeries(oracleKey: string): HistoricalPriceSeries | undefined {
    return this.injected.get(oracleKey);
  }

  public updateOracleWithLag(
    provider: anchor.AnchorProvider,
    oraclePubkey: PublicKey,
    price: number,
    slot: number
  ): Promise<void> {
    // In real sim this would push a lagged price update via the test validator
    console.log(`[LagInjector] Updating oracle ${oraclePubkey.toBase58()} with price ${price} at slot ${slot} (lag applied)`);
    return Promise.resolve();
  }
}

export function createLagInjector(config: LagInjectorConfig): LagInjector {
  return new LagInjector(config);
}

export function checkTWAPFalsePositive(
  series: HistoricalPriceSeries,
  twapConfig: TWAPConfig
): boolean {
  if (series.length < 2) return false;
  const twap = OracleUtils.calculateTWAP(series, twapConfig.windowMs);
  const latest = series[series.length - 1].price;
  const deviationBps = Math.abs((latest - twap) / twap) * 10000;
  return deviationBps < twapConfig.thresholdBps;
}

// Re-export types for convenience
export type { PriceData as OraclePriceData };
export { HistoricalPriceSeries, LagInjectorConfig, OracleConfig, TWAPConfig, VaultState };
