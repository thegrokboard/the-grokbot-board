import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

export interface PriceData {
  price: number;
  slot: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
}

export interface LagInjectorConfig {
  oracleLagSlots: number;
  slotDurationMs: number;
  basePriceSeries: PriceData[];
}

export interface OracleLagInjector {
  injectPriceAtSlot(slot: number, price: number): Promise<void>;
  getCurrentPrice(): Promise<number>;
  getPriceHistory(): Promise<PriceData[]>;
  advanceSlot(): Promise<void>;
  getHistoricalPriceSeries(startSlot: number, endSlot: number): Promise<HistoricalPriceSeries>;
  injectPrice(price: number): Promise<void>;
  getRecentPrices(count: number): Promise<PriceData[]>;
}

export class OracleLagInjectorImpl implements OracleLagInjector {
  private currentSlot: number = 0;
  private prices: Map<number, PriceData> = new Map();
  private config: LagInjectorConfig;

  constructor(config: LagInjectorConfig) {
    this.config = { ...config };
    this.currentSlot = 0;
    // Seed initial prices
    for (const p of this.config.basePriceSeries) {
      this.prices.set(p.slot, { ...p });
    }
    if (this.prices.size === 0 && this.config.basePriceSeries.length > 0) {
      this.currentSlot = this.config.basePriceSeries[0].slot;
    }
  }

  async injectPriceAtSlot(slot: number, price: number): Promise<void> {
    this.prices.set(slot, {
      price,
      slot,
      timestamp: Date.now(),
    });
  }

  async getCurrentPrice(): Promise<number> {
    const recent = await this.getRecentPrices(1);
    return recent.length > 0 ? recent[0].price : 1.0;
  }

  async getPriceHistory(): Promise<PriceData[]> {
    return Array.from(this.prices.values())
      .sort((a, b) => a.slot - b.slot);
  }

  async advanceSlot(): Promise<void> {
    this.currentSlot += 1;
    // Auto-inject lagged price if we have history
    const laggedSlot = this.currentSlot - this.config.oracleLagSlots;
    const laggedPrice = this.prices.get(laggedSlot);
    if (laggedPrice) {
      await this.injectPriceAtSlot(this.currentSlot, laggedPrice.price);
    }
  }

  async getHistoricalPriceSeries(startSlot: number, endSlot: number): Promise<HistoricalPriceSeries> {
    const filtered = Array.from(this.prices.values())
      .filter(p => p.slot >= startSlot && p.slot <= endSlot)
      .sort((a, b) => a.slot - b.slot);
    return { prices: filtered };
  }

  async injectPrice(price: number): Promise<void> {
    await this.injectPriceAtSlot(this.currentSlot, price);
  }

  async getRecentPrices(count: number): Promise<PriceData[]> {
    const sorted = await this.getPriceHistory();
    return sorted.slice(-count);
  }
}

export function injectLag(series: PriceData[], lagSlots: number): PriceData[] {
  return series.map(p => ({
    ...p,
    slot: p.slot + lagSlots,
  }));
}

export async function getHistoricalPriceSeries(
  connection: Connection,
  oraclePubkey: PublicKey,
  startSlot: number,
  endSlot: number
): Promise<HistoricalPriceSeries> {
  // Stub for test validator simulation - in real use would query onchain oracle
  return { prices: [] };
}

export function createLagInjector(config: LagInjectorConfig): OracleLagInjector {
  return new OracleLagInjectorImpl(config);
}
