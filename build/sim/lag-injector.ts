import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { getHistoricalJitoPrices, PriceData, HistoricalPriceSeries } from "./oracle-utils";

export interface LagInjectorConfig {
  lagSlots: number;
  oraclePubkey: PublicKey;
  jitoSolMint: PublicKey;
}

export class LagInjector {
  private connection: Connection;
  private config: LagInjectorConfig;
  private series: HistoricalPriceSeries = [];
  private currentIndex: number = 0;
  private slotOffset: number = 0;

  constructor(connection: Connection, config: LagInjectorConfig) {
    this.connection = connection;
    this.config = config;
    this.slotOffset = config.lagSlots;
  }

  async loadSeries(): Promise<void> {
    this.series = await getHistoricalJitoPrices();
    this.currentIndex = 0;
    console.log(`Loaded ${this.series.length} historical JitoSOL price points for lag simulation`);
  }

  getCurrentPriceData(currentSlot: number): PriceData | null {
    if (this.series.length === 0) return null;

    const laggedSlot = Math.max(0, currentSlot - this.slotOffset);
    let index = this.series.findIndex(p => p.slot >= laggedSlot);
    if (index === -1) index = this.series.length - 1;
    if (index >= this.series.length) index = this.series.length - 1;

    const data = this.series[index];
    return {
      price: data.price,
      confidence: data.confidence,
      timestamp: data.timestamp,
    };
  }

  async injectPrice(currentSlot: number, oraclePubkey?: PublicKey): Promise<void> {
    const priceData = this.getCurrentPriceData(currentSlot);
    if (!priceData) {
      console.warn("No price data available for injection");
      return;
    }

    const targetOracle = oraclePubkey || this.config.oraclePubkey;
    console.log(`[LagInjector] Slot ${currentSlot} (lagged ~${this.slotOffset} slots): injecting price=${priceData.price} confidence=${priceData.confidence} ts=${priceData.timestamp} to ${targetOracle.toBase58()}`);

    // In test-validator sim we log; real injection would use a mock oracle account update
    // For pure-onchain harness this drives the TWAP checker against delayed feed
    this.currentIndex = Math.min(this.currentIndex + 1, this.series.length - 1);
  }

  reset(): void {
    this.currentIndex = 0;
  }

  getSeriesLength(): number {
    return this.series.length;
  }
}
