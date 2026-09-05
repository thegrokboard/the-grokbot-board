import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";

export interface PriceData {
  price: number;
  slot: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
}

export interface LagInjectorConfig {
  lagSlots: number;
  oracleProgramId: PublicKey;
  priceFeed: PublicKey;
  slotDurationMs?: number; // optional to satisfy older references
}

export interface OracleLagInjector {
  injectLag(connection: Connection, config: LagInjectorConfig): Promise<void>;
  injectPrice(price: number, slot: number): Promise<void>;
  getCurrentPrice(): Promise<PriceData>;
  getRecentPrices(count: number): Promise<PriceData[]>;
  getHistoricalPriceSeries(startSlot: number, endSlot: number): Promise<HistoricalPriceSeries>;
}

export class OracleLagInjectorImpl implements OracleLagInjector {
  private prices: PriceData[] = [];
  private currentSlot = 1000;
  private lagSlots: number = 45 * 2; // approx 45s at 400ms/slot

  constructor(private connection: Connection, config?: LagInjectorConfig) {
    if (config) {
      this.lagSlots = config.lagSlots;
    }
  }

  async injectLag(connection: Connection, config: LagInjectorConfig): Promise<void> {
    this.lagSlots = config.lagSlots;
    // Simulate lag by advancing internal clock without updating oracle on-chain
    console.log(`[LagInjector] Configured lag of ${this.lagSlots} slots`);
    this.currentSlot += this.lagSlots;
  }

  async injectPrice(price: number, slot: number): Promise<void> {
    this.prices.push({ price, slot, timestamp: Date.now() });
    this.currentSlot = Math.max(this.currentSlot, slot);
    console.log(`[LagInjector] Injected price ${price} at slot ${slot}`);
  }

  async getCurrentPrice(): Promise<PriceData> {
    if (this.prices.length === 0) {
      return { price: 1.0, slot: this.currentSlot, timestamp: Date.now() };
    }
    return this.prices[this.prices.length - 1];
  }

  async getRecentPrices(count: number): Promise<PriceData[]> {
    return this.prices.slice(-count);
  }

  async getHistoricalPriceSeries(startSlot: number, endSlot: number): Promise<HistoricalPriceSeries> {
    const filtered = this.prices.filter(p => p.slot >= startSlot && p.slot <= endSlot);
    return { prices: filtered };
  }
}

export function injectLag(connection: Connection, config: LagInjectorConfig): Promise<void> {
  const injector = new OracleLagInjectorImpl(connection, config);
  return injector.injectLag(connection, config);
}

export function getHistoricalPriceSeries(
  series: HistoricalPriceSeries,
  lagSlots: number
): HistoricalPriceSeries {
  const laggedPrices = series.prices.map(p => ({
    ...p,
    slot: p.slot - lagSlots,
  }));
  return { prices: laggedPrices };
}

export const OracleLagInjector = OracleLagInjectorImpl;
