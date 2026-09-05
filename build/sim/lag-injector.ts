import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { OracleUtils, PriceData } from "./oracle-utils";

export interface LagInjectorConfig {
  oracleProgramId: PublicKey;
  priceFeed: PublicKey;
  lagSlots: number;
  jitoSolMint: PublicKey;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  startSlot: number;
  endSlot: number;
}

export class LagInjector {
  private config: LagInjectorConfig;
  private connection: Connection;
  private oracleUtils: OracleUtils;
  private currentLagOffset: number = 0;
  private replaySeries: HistoricalPriceSeries | null = null;

  constructor(config: LagInjectorConfig, connection: Connection) {
    this.config = config;
    this.connection = connection;
    this.oracleUtils = new OracleUtils(connection, config.oracleProgramId);
  }

  async loadHistoricalSeries(): Promise<HistoricalPriceSeries> {
    // Replay of last three known JitoSOL depeg price series (synthetic but realistic)
    const baseSlot = 123456789;
    const series: PriceData[] = [
      { price: 0.95, confidence: 0.01, timestamp: 1690000000 },
      { price: 0.94, confidence: 0.02, timestamp: 1690000030 },
      { price: 0.92, confidence: 0.03, timestamp: 1690000060 },
      { price: 0.85, confidence: 0.05, timestamp: 1690000120 },
      { price: 0.78, confidence: 0.08, timestamp: 1690000180 },
      { price: 0.75, confidence: 0.10, timestamp: 1690000240 },
      { price: 0.82, confidence: 0.06, timestamp: 1690000300 },
      { price: 0.88, confidence: 0.04, timestamp: 1690000360 },
      { price: 0.91, confidence: 0.02, timestamp: 1690000420 },
      { price: 0.96, confidence: 0.01, timestamp: 1690000480 },
      // Second depeg wave
      { price: 0.89, confidence: 0.03, timestamp: 1690100000 },
      { price: 0.81, confidence: 0.07, timestamp: 1690100060 },
      { price: 0.72, confidence: 0.12, timestamp: 1690100120 },
      { price: 0.68, confidence: 0.15, timestamp: 1690100180 },
      { price: 0.75, confidence: 0.09, timestamp: 1690100240 },
      // Recovery
      { price: 0.93, confidence: 0.02, timestamp: 1690200000 },
      { price: 0.97, confidence: 0.01, timestamp: 1690200060 },
      { price: 0.99, confidence: 0.005, timestamp: 1690200120 },
      { price: 1.00, confidence: 0.001, timestamp: 1690200180 },
    ];

    this.replaySeries = {
      prices: series,
      startSlot: baseSlot,
      endSlot: baseSlot + series.length * 8,
    };

    return this.replaySeries;
  }

  async injectLaggedPrice(currentSlot: number): Promise<void> {
    if (!this.replaySeries) {
      await this.loadHistoricalSeries();
    }

    const series = this.replaySeries!;
    const laggedSlot = Math.max(
      series.startSlot,
      currentSlot - this.config.lagSlots
    );

    const index = Math.min(
      Math.floor((laggedSlot - series.startSlot) / 8),
      series.prices.length - 1
    );

    const priceData = series.prices[index];

    // Update on-chain oracle with lagged price (using test validator writable account simulation)
    await this.oracleUtils.setTestPrice(
      this.config.priceFeed,
      priceData.price,
      priceData.confidence,
      priceData.timestamp
    );

    this.currentLagOffset = this.config.lagSlots;
  }

  getCurrentLagSlots(): number {
    return this.currentLagOffset;
  }

  async reset(): Promise<void> {
    this.currentLagOffset = 0;
    this.replaySeries = null;
  }
}

// Utility for 45s target lag (approx 90 slots at 400ms/slot)
export const DEFAULT_LAG_CONFIG: LagInjectorConfig = {
  oracleProgramId: new PublicKey("11111111111111111111111111111111"),
  priceFeed: new PublicKey("22222222222222222222222222222222"),
  lagSlots: 90,
  jitoSolMint: new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"),
};

export async function createLagInjector(
  provider: anchor.Provider,
  config: Partial<LagInjectorConfig> = {}
): Promise<LagInjector> {
  const fullConfig: LagInjectorConfig = {
    ...DEFAULT_LAG_CONFIG,
    ...config,
    oracleProgramId: config.oracleProgramId || DEFAULT_LAG_CONFIG.oracleProgramId,
    priceFeed: config.priceFeed || DEFAULT_LAG_CONFIG.priceFeed,
    jitoSolMint: config.jitoSolMint || DEFAULT_LAG_CONFIG.jitoSolMint,
  };

  return new LagInjector(fullConfig, provider.connection);
}
