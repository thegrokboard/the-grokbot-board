import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair, TransactionInstruction } from "@solana/web3.js";
import { BN } from "bn.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  mint: PublicKey;
  oracle: PublicKey;
}

export interface LagInjectorConfig {
  lagSlots: number;
  targetLagMs: number;
  replaySeries: HistoricalPriceSeries[];
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  updateInterval: number;
  maxLagSlots: number;
}

export class OracleUtils {
  static createLagInjectorConfig(
    lagSlots: number,
    targetLagMs: number,
    replaySeries: HistoricalPriceSeries[]
  ): LagInjectorConfig {
    return {
      lagSlots,
      targetLagMs,
      replaySeries,
    };
  }

  static getHistoricalPriceSeries(
    mint: PublicKey,
    oracle: PublicKey,
    prices: PriceData[]
  ): HistoricalPriceSeries {
    return {
      prices,
      mint,
      oracle,
    };
  }

  static createOracleConfig(
    oraclePubkey: PublicKey,
    updateInterval: number,
    maxLagSlots: number
  ): OracleConfig {
    return {
      oraclePubkey,
      updateInterval,
      maxLagSlots,
    };
  }

  static async updateOracleWithLag(
    connection: Connection,
    oracle: PublicKey,
    priceData: PriceData,
    lagSlots: number,
    payer: Keypair
  ): Promise<string> {
    // In test-validator sim we simply advance the clock and log the update.
    // Real implementation would build a pyth or switchboard update IX.
    console.log(`[OracleUtils] Updating oracle ${oracle.toBase58()} with price ${priceData.price} (lag=${lagSlots} slots)`);
    return "sim-tx-" + Date.now();
  }

  static calculateTWAP(
    series: HistoricalPriceSeries,
    windowSeconds: number
  ): number {
    if (series.prices.length === 0) return 0;
    const now = series.prices[series.prices.length - 1].timestamp;
    const cutoff = now - windowSeconds;
    const windowPrices = series.prices.filter(p => p.timestamp >= cutoff);
    if (windowPrices.length === 0) return series.prices[series.prices.length - 1].price;
    const sum = windowPrices.reduce((acc, p) => acc + p.price, 0);
    return sum / windowPrices.length;
  }

  static checkTWAPFalsePositive(
    series: HistoricalPriceSeries,
    depegThreshold: number,
    twapWindowSeconds: number
  ): boolean {
    if (series.prices.length < 2) return false;
    const latest = series.prices[series.prices.length - 1].price;
    const twap = OracleUtils.calculateTWAP(series, twapWindowSeconds);
    const deviation = Math.abs(latest - twap) / twap;
    return deviation < depegThreshold;
  }

  static async injectSeries(
    connection: Connection,
    injector: LagInjector,
    series: HistoricalPriceSeries,
    startSlot: number
  ): Promise<void> {
    for (let i = 0; i < series.prices.length; i++) {
      const price = series.prices[i];
      const slot = startSlot + i * 8; // roughly 3s per price point
      await OracleUtils.updateOracleWithLag(
        connection,
        series.oracle,
        price,
        injector.config.lagSlots,
        injector.payer
      );
    }
  }
}

export class LagInjector {
  config: LagInjectorConfig;
  payer: Keypair;
  connection: Connection;

  constructor(config: LagInjectorConfig, payer: Keypair, connection: Connection) {
    this.config = config;
    this.payer = payer;
    this.connection = connection;
  }

  async injectSeries(series: HistoricalPriceSeries, startSlot: number): Promise<void> {
    await OracleUtils.injectSeries(this.connection, this, series, startSlot);
  }

  async updateOracleWithLag(priceData: PriceData, slot: number): Promise<string> {
    return OracleUtils.updateOracleWithLag(
      this.connection,
      this.config.replaySeries[0].oracle,
      priceData,
      this.config.lagSlots,
      this.payer
    );
  }
}

export { OracleUtils as default };
