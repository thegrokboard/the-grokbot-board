import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { Oracle as OracleProgram } from "../target/types/oracle"; // assume a minimal oracle IDL for sim

export interface PriceData {
  price: number; // in USD, scaled e.g. 1.0 = 1e9 for precision
  timestamp: number; // unix timestamp in seconds
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  startSlot: number;
  endSlot: number;
}

export interface LagInjectorConfig {
  lagSlots: number; // target oracle lag in slots (e.g. 45s ~ 200 slots at 225ms/slot)
  replaySpeed: number; // multiplier for replay speed (1 = real-time)
  oracleProgramId: PublicKey;
  jitoSolMint: PublicKey;
}

export interface OracleConfig {
  lagSlots: number;
  confidenceThreshold: number; // e.g. 0.05 for 5%
  twapWindowSlots: number; // for 15s TWAP
}

export class OracleUtils {
  static createPriceData(price: number, timestamp: number): PriceData {
    return { price, timestamp };
  }

  static createHistoricalPriceSeries(prices: PriceData[], startSlot: number, endSlot: number): HistoricalPriceSeries {
    return { prices, startSlot, endSlot };
  }

  static createLagInjectorConfig(
    lagSlots: number = 200,
    replaySpeed: number = 1,
    oracleProgramId: PublicKey = new PublicKey("11111111111111111111111111111111"),
    jitoSolMint: PublicKey = new PublicKey("J1toso1uCk3RLmjorhT2mH4g5bY3qL3mQ5d4f3zqL5")
  ): LagInjectorConfig {
    return { lagSlots, replaySpeed, oracleProgramId, jitoSolMint };
  }

  static createOracleConfig(lagSlots: number = 200, confidenceThreshold: number = 0.05, twapWindowSlots: number = 67): OracleConfig {
    return { lagSlots, confidenceThreshold, twapWindowSlots };
  }

  static async getHistoricalPriceSeries(
    connection: Connection,
    oraclePubkey: PublicKey,
    startSlot: number,
    endSlot?: number
  ): Promise<HistoricalPriceSeries> {
    // For sim harness we use synthetic JitoSOL depeg series from known events (Nov 2024)
    const syntheticPrices: PriceData[] = [
      { price: 0.98, timestamp: 1731000000 },
      { price: 0.95, timestamp: 1731000060 },
      { price: 0.92, timestamp: 1731000120 },
      { price: 0.85, timestamp: 1731000180 },
      { price: 0.78, timestamp: 1731000240 },
      { price: 0.72, timestamp: 1731000300 },
      { price: 0.68, timestamp: 1731000360 },
      { price: 0.75, timestamp: 1731000420 },
      { price: 0.82, timestamp: 1731000480 },
      { price: 0.89, timestamp: 1731000540 },
      { price: 0.94, timestamp: 1731000600 },
    ];

    const slotDuration = 0.225; // seconds per slot
    const startTs = Math.floor(Date.now() / 1000) - 3600;
    const adjustedPrices = syntheticPrices.map((p, i) => ({
      price: p.price,
      timestamp: startTs + i * 60,
    }));

    const computedEndSlot = startSlot + Math.floor((adjustedPrices.length * 60) / slotDuration);
    return {
      prices: adjustedPrices,
      startSlot,
      endSlot: endSlot || computedEndSlot,
    };
  }

  static filterSeries(series: HistoricalPriceSeries, predicate: (p: PriceData) => boolean): HistoricalPriceSeries {
    const filteredPrices = series.prices.filter(predicate);
    return {
      prices: filteredPrices,
      startSlot: series.startSlot,
      endSlot: series.endSlot,
    };
  }

  static getLastNPrices(series: HistoricalPriceSeries, n: number): PriceData[] {
    return series.prices.slice(-n);
  }

  static calculateTWAP(prices: PriceData[], windowSeconds: number = 15): number {
    if (prices.length === 0) return 0;
    const now = prices[prices.length - 1].timestamp;
    const windowStart = now - windowSeconds;
    const windowPrices = prices.filter(p => p.timestamp >= windowStart);
    if (windowPrices.length === 0) return prices[prices.length - 1].price;

    let sum = 0;
    let totalTime = 0;
    let lastTs = windowStart;

    for (const p of windowPrices) {
      const dt = p.timestamp - lastTs;
      sum += p.price * dt;
      totalTime += dt;
      lastTs = p.timestamp;
    }
    return totalTime > 0 ? sum / totalTime : windowPrices[0].price;
  }

  static checkTWAPFalsePositive(series: HistoricalPriceSeries, currentPrice: number, threshold: number = 0.1): boolean {
    if (series.prices.length < 5) return false;
    const recentPrices = this.getLastNPrices(series, 20);
    const twap15s = this.calculateTWAP(recentPrices, 15);
    const drawdown = (twap15s - currentPrice) / twap15s;
    return drawdown > threshold;
  }
}

export const OracleUtilsClass = OracleUtils; // alias for legacy import style
export { OracleUtils as OracleUtils };
export type { PriceData, HistoricalPriceSeries, LagInjectorConfig, OracleConfig };
