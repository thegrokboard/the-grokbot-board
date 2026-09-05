import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";

export interface LagInjectorConfig {
  oracleLagSlots: number;
  jitoSolMint?: PublicKey;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
}

export class LagInjector {
  private config: LagInjectorConfig;
  private priceHistory: PriceData[] = [];
  private currentSlot: number = 0;
  private lagSlots: number;

  constructor(config: LagInjectorConfig) {
    this.config = config;
    this.lagSlots = config.oracleLagSlots;
    this.priceHistory = [];
  }

  async loadHistory(connection: Connection, startSlot: number, numSlots: number): Promise<void> {
    const series: HistoricalPriceSeries = await getHistoricalJitoPrices(connection, startSlot, numSlots);
    this.priceHistory = series.prices;
    this.currentSlot = startSlot;
  }

  injectPriceAtSlot(slot: number, price: number, confidence: number = 0.01): void {
    const data: PriceData = {
      price,
      confidence,
      slot
    };
    this.priceHistory.push(data);
    this.priceHistory.sort((a, b) => a.slot - b.slot);
    this.currentSlot = Math.max(this.currentSlot, slot);
  }

  getCurrentPrice(currentSlot: number): PriceData | null {
    if (this.priceHistory.length === 0) return null;
    
    const effectiveSlot = currentSlot - this.lagSlots;
    let best: PriceData | null = null;
    let minDiff = Infinity;

    for (const p of this.priceHistory) {
      if (p.slot > effectiveSlot) break;
      const diff = Math.abs(p.slot - effectiveSlot);
      if (diff < minDiff) {
        minDiff = diff;
        best = p;
      }
    }
    return best || this.priceHistory[this.priceHistory.length - 1];
  }

  getPriceHistory(): PriceData[] {
    return [...this.priceHistory];
  }

  getLagSlots(): number {
    return this.lagSlots;
  }

  advanceSlot(slots: number = 1): void {
    this.currentSlot += slots;
  }

  getCurrentSlot(): number {
    return this.currentSlot;
  }
}

export default LagInjector;
