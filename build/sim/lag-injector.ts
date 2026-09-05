import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";

export interface PriceData {
  price: number;
  confidence: number;
  timestamp: number;
  slot: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  depegStartSlot: number;
}

export interface LagInjectorConfig {
  rpcUrl: string;
  lagSeconds: number;
  startSlot?: number;
}

export interface OracleLagInjector {
  injectPriceAtSlot(slot: number, price: number, confidence?: number): Promise<void>;
  getCurrentPrice(): Promise<PriceData>;
  getPriceHistory(): HistoricalPriceSeries;
  advanceSlot(slots?: number): Promise<number>;
}

export class LagInjector implements OracleLagInjector {
  private connection: Connection;
  private currentSlot: number;
  private priceHistory: PriceData[] = [];
  private lagSlots: number;
  private config: LagInjectorConfig;

  constructor(config: LagInjectorConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, "confirmed");
    this.lagSlots = Math.floor((config.lagSeconds || 45) * 2); // ~2 slots per second
    this.currentSlot = config.startSlot || 100_000_000;
    this.priceHistory = [];
    this.initializeHistoricalData();
  }

  private initializeHistoricalData() {
    // Replay of last three JitoSOL depeg-style price series (synthetic but realistic)
    const baseSlot = this.currentSlot - 2000;
    const series: Array<{price: number, slotOffset: number}> = [
      // Series 1: minor volatility
      {price: 0.98, slotOffset: 0},
      {price: 0.975, slotOffset: 25},
      {price: 0.97, slotOffset: 60},
      {price: 0.965, slotOffset: 120},
      {price: 0.98, slotOffset: 300},
      // Series 2: sharp depeg
      {price: 0.92, slotOffset: 450},
      {price: 0.85, slotOffset: 520},
      {price: 0.78, slotOffset: 580},
      {price: 0.75, slotOffset: 650},
      {price: 0.88, slotOffset: 820},
      // Series 3: prolonged depeg with recovery
      {price: 0.82, slotOffset: 1100},
      {price: 0.71, slotOffset: 1250},
      {price: 0.68, slotOffset: 1380},
      {price: 0.72, slotOffset: 1600},
      {price: 0.95, slotOffset: 1950},
    ];

    this.priceHistory = series.map((entry, i) => ({
      price: entry.price,
      confidence: 0.95 + (i % 5) * 0.01,
      timestamp: Math.floor(Date.now() / 1000) - (2000 - entry.slotOffset) * 0.5,
      slot: baseSlot + entry.slotOffset,
    }));

    // Ensure sorted by slot
    this.priceHistory.sort((a, b) => a.slot - b.slot);
  }

  async injectPriceAtSlot(slot: number, price: number, confidence: number = 0.98): Promise<void> {
    const newPrice: PriceData = {
      price,
      confidence,
      timestamp: Math.floor(Date.now() / 1000),
      slot,
    };
    this.priceHistory.push(newPrice);
    this.priceHistory.sort((a, b) => a.slot - b.slot);
    if (slot > this.currentSlot) {
      this.currentSlot = slot;
    }
  }

  async getCurrentPrice(): Promise<PriceData> {
    // Return lagged price: find most recent price that is at least lagSlots behind currentSlot
    const targetSlot = this.currentSlot - this.lagSlots;
    let bestPrice = this.priceHistory[0];
    for (const p of this.priceHistory) {
      if (p.slot <= targetSlot) {
        bestPrice = p;
      } else {
        break;
      }
    }
    return { ...bestPrice };
  }

  getPriceHistory(): HistoricalPriceSeries {
    // Find approximate depeg start (first price < 0.90)
    let depegStartSlot = this.priceHistory[0].slot;
    for (const p of this.priceHistory) {
      if (p.price < 0.90) {
        depegStartSlot = p.slot;
        break;
      }
    }
    return {
      prices: [...this.priceHistory],
      depegStartSlot,
    };
  }

  async advanceSlot(slots: number = 1): Promise<number> {
    this.currentSlot += slots;
    return this.currentSlot;
  }

  // Helper for test harness
  getCurrentSlot(): number {
    return this.currentSlot;
  }
}

// Factory for sim use
export function createLagInjector(config: LagInjectorConfig): OracleLagInjector {
  return new LagInjector(config);
}
