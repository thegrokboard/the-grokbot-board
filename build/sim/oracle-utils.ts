import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  startSlot: number;
  slotInterval: number;
}

export interface LagInjectorConfig {
  lagSlots: number;
  targetLagSeconds: number;
  series: HistoricalPriceSeries[];
}

export interface OracleConfig {
  lagSlots: number;
  updateInterval: number;
}

export class OracleUtils {
  static createPriceData(price: number, timestamp: number): PriceData {
    return { price, timestamp };
  }

  static createHistoricalPriceSeries(
    prices: PriceData[],
    startSlot: number,
    slotInterval: number
  ): HistoricalPriceSeries {
    return { prices, startSlot, slotInterval };
  }

  static createLagInjectorConfig(
    lagSlots: number,
    targetLagSeconds: number,
    series: HistoricalPriceSeries[]
  ): LagInjectorConfig {
    return { lagSlots, targetLagSeconds, series };
  }

  static createOracleConfig(lagSlots: number, updateInterval: number): OracleConfig {
    return { lagSlots, updateInterval };
  }

  static calculateTWAP(prices: PriceData[], windowSeconds: number): number {
    if (prices.length === 0) return 0;
    const endTime = prices[prices.length - 1].timestamp;
    const startTime = endTime - windowSeconds;
    const windowPrices = prices.filter(p => p.timestamp >= startTime);
    if (windowPrices.length === 0) return prices[prices.length - 1].price;
    const sum = windowPrices.reduce((acc, p) => acc + p.price, 0);
    return sum / windowPrices.length;
  }

  static isDepeg(currentTWAP: number, referencePrice: number, threshold: number): boolean {
    if (referencePrice === 0) return false;
    const deviation = Math.abs(currentTWAP - referencePrice) / referencePrice;
    return deviation > threshold;
  }
}

export class LagInjector {
  private connection: Connection;
  private oraclePubkey: PublicKey;
  private config: LagInjectorConfig;

  constructor(connection: Connection, oraclePubkey: PublicKey, config: LagInjectorConfig) {
    this.connection = connection;
    this.oraclePubkey = oraclePubkey;
    this.config = config;
  }

  async injectSeries(seriesIndex: number, slotOffset: number): Promise<void> {
    const series = this.config.series[seriesIndex];
    if (!series || series.prices.length === 0) return;

    const currentSlot = await this.getCurrentSlot();
    const baseSlot = currentSlot - slotOffset;

    for (let i = 0; i < series.prices.length; i++) {
      const priceData = series.prices[i];
      const targetSlot = baseSlot + Math.floor((priceData.timestamp - series.prices[0].timestamp) / 0.4);
      const lagSlot = targetSlot - this.config.lagSlots;

      await this.updateOracleWithLag(priceData.price, lagSlot);
    }
  }

  private async getCurrentSlot(): Promise<number> {
    const slot = await this.connection.getSlot();
    return slot;
  }

  private async updateOracleWithLag(price: number, slot: number): Promise<void> {
    // In test harness this would update a mock oracle account at the lagged slot
    // For simulation we simply log the action; real implementation would use a custom oracle program
    console.log(`[LagInjector] Update oracle at slot ${slot} with price ${price}`);
  }

  async advanceToSlot(targetSlot: number): Promise<void> {
    // Simulate slot advancement for test validator
    console.log(`[LagInjector] Advanced to slot ${targetSlot}`);
  }
}

export function checkTWAPFalsePositive(
  series: HistoricalPriceSeries,
  windowSeconds: number,
  depegThreshold: number,
  referencePrice: number
): boolean {
  const twap = OracleUtils.calculateTWAP(series.prices, windowSeconds);
  const isFlagged = OracleUtils.isDepeg(twap, referencePrice, depegThreshold);
  // False positive = flagged but price never actually crossed threshold in raw series
  if (!isFlagged) return false;
  const maxDeviation = series.prices.reduce((max, p) => {
    const dev = Math.abs(p.price - referencePrice) / referencePrice;
    return Math.max(max, dev);
  }, 0);
  return maxDeviation <= depegThreshold;
}

export async function runSimulationTick(
  provider: anchor.AnchorProvider,
  program: Program,
  injector: LagInjector,
  checker: any,
  tick: number,
  series: HistoricalPriceSeries[]
): Promise<{ breakerTripped: boolean; falsePositive: boolean }> {
  const currentSlot = await provider.connection.getSlot();
  const laggedSlot = currentSlot - 120; // example 45s @ ~400ms/slot

  await injector.advanceToSlot(laggedSlot);

  if (tick % 3 === 0 && series.length > 0) {
    await injector.injectSeries(0, laggedSlot);
  }

  const lastSeries = series[series.length - 1] || OracleUtils.createHistoricalPriceSeries([], 0, 1);
  const falsePositive = checkTWAPFalsePositive(lastSeries, 15, 0.05, 1.0);
  const breakerTripped = falsePositive; // simplified for harness

  return { breakerTripped, falsePositive };
}

// Re-export for backward compatibility with existing sim files
export { OracleUtils as default };
