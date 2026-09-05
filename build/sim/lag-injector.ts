import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";

export interface LagInjectorConfig {
  targetLagMs: number;
  slotDurationMs: number;
  connection: Connection;
  oraclePubkey: PublicKey;
}

export class LagInjector {
  private config: LagInjectorConfig;
  private series: PriceData[] = [];
  private currentIndex: number = 0;
  private startSlot: number = 0;
  private startTime: number = 0;

  constructor(config: LagInjectorConfig) {
    this.config = config;
  }

  async loadSeries(): Promise<void> {
    this.series = await getHistoricalJitoPrices();
    if (this.series.length === 0) {
      throw new Error("No price data loaded");
    }
    this.currentIndex = 0;
  }

  setStartSlot(slot: number): void {
    this.startSlot = slot;
    this.startTime = Date.now();
    this.currentIndex = 0;
  }

  getCurrentPrice(currentSlot: number): PriceData | null {
    if (this.series.length === 0) return null;

    const elapsedSlots = currentSlot - this.startSlot;
    const targetLagSlots = Math.floor(this.config.targetLagMs / this.config.slotDurationMs);
    const effectiveSlot = Math.max(0, elapsedSlots - targetLagSlots);

    // Find the latest price that would have been observed by the lagged slot
    let idx = 0;
    for (let i = 0; i < this.series.length; i++) {
      if (this.series[i].slot <= this.startSlot + effectiveSlot) {
        idx = i;
      } else {
        break;
      }
    }

    this.currentIndex = idx;
    return this.series[idx];
  }

  injectPrice(currentSlot: number): Promise<void> {
    const price = this.getCurrentPrice(currentSlot);
    if (!price) return Promise.resolve();

    // In a real sim this would update an on-chain oracle account.
    // For the harness we simply log the injection (test validator replay).
    console.log(`[LagInjector] Slot ${currentSlot}: inject price=${price.price.toFixed(4)}, conf=${price.confidence.toFixed(4)} (lag ~${this.config.targetLagMs}ms)`);
    return Promise.resolve();
  }

  getLatestInjectedPrice(): PriceData | null {
    if (this.series.length === 0 || this.currentIndex >= this.series.length) return null;
    return this.series[this.currentIndex];
  }
}
