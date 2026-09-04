import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { OracleUtils, PriceData } from "./oracle-utils";

export interface LagInjectorConfig {
  oracleProgramId: PublicKey;
  priceFeed: PublicKey;
  lagSlots: number;
  rpcUrl?: string;
}

export class LagInjector {
  private connection: Connection;
  private oracleUtils: OracleUtils;
  private config: LagInjectorConfig;
  private priceHistory: PriceData[] = [];
  private currentSlot = 0;

  constructor(config: LagInjectorConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl || "http://127.0.0.1:8899", "confirmed");
    this.oracleUtils = new OracleUtils(this.connection, config.oracleProgramId);
  }

  async loadPriceHistory(prices: PriceData[]): Promise<void> {
    this.priceHistory = [...prices];
    this.currentSlot = 0;
    console.log(`Loaded ${this.priceHistory.length} historical prices for lag replay`);
  }

  async advanceSlot(slots: number = 1): Promise<void> {
    this.currentSlot += slots;
    await this.injectLag();
  }

  async injectLag(): Promise<void> {
    if (this.priceHistory.length === 0) return;

    // Calculate lagged index: lagSlots behind current simulated slot
    const lagIndex = Math.max(0, this.currentSlot - this.config.lagSlots);
    const effectiveIndex = Math.min(lagIndex, this.priceHistory.length - 1);
    const laggedPrice = this.priceHistory[effectiveIndex];

    console.log(`[LagInjector] Slot ${this.currentSlot} | lag=${this.config.lagSlots} | using price from slot ~${effectiveIndex} = ${laggedPrice.price}`);

    // Update on-chain oracle with the lagged price
    await this.oracleUtils.setPrice(this.config.priceFeed, laggedPrice.price, laggedPrice.confidence, this.currentSlot);
  }

  getCurrentLagPrice(): number {
    if (this.priceHistory.length === 0) return 1.0;
    const lagIndex = Math.max(0, this.currentSlot - this.config.lagSlots);
    const effectiveIndex = Math.min(lagIndex, this.priceHistory.length - 1);
    return this.priceHistory[effectiveIndex].price;
  }

  async replayLastThreeDepegs(): Promise<void> {
    // Simulated JitoSOL depeg series (price, confidence). Real data would be loaded from JSON.
    const depegSeries: PriceData[] = [
      // Stable period
      { price: 1.00, confidence: 0.001, slot: 100 },
      { price: 1.00, confidence: 0.001, slot: 110 },
      { price: 0.999, confidence: 0.002, slot: 120 },
      // First depeg (flash crash to ~0.92)
      { price: 0.98, confidence: 0.01, slot: 200 },
      { price: 0.94, confidence: 0.03, slot: 210 },
      { price: 0.92, confidence: 0.05, slot: 220 },
      { price: 0.93, confidence: 0.04, slot: 230 },
      // Recovery
      { price: 0.96, confidence: 0.02, slot: 240 },
      { price: 0.99, confidence: 0.005, slot: 250 },
      // Second depeg
      { price: 0.97, confidence: 0.015, slot: 300 },
      { price: 0.89, confidence: 0.08, slot: 310 },
      { price: 0.85, confidence: 0.12, slot: 320 },
      { price: 0.88, confidence: 0.09, slot: 330 },
      // Third (milder) depeg used for false-positive testing
      { price: 0.975, confidence: 0.008, slot: 400 },
      { price: 0.96, confidence: 0.012, slot: 410 },
      { price: 0.955, confidence: 0.018, slot: 420 },
      { price: 0.97, confidence: 0.006, slot: 430 },
    ];

    await this.loadPriceHistory(depegSeries);
    console.log("Replaying last three JitoSOL depeg events with configurable oracle lag");
  }
}
