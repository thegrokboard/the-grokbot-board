import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { TestOracle } from "./oracle-utils";

export interface PriceData {
  price: number;
  confidence: number;
  timestamp: number;
}

export class LagInjector {
  private oracle: TestOracle;
  private priceHistory: PriceData[] = [];
  private currentSlot: number = 0;
  private lagSlots: number = 90; // ~45s at 500ms/slot target

  constructor(oracle: TestOracle, initialLagSlots: number = 90) {
    this.oracle = oracle;
    this.lagSlots = initialLagSlots;
    this.priceHistory = [];
  }

  public setPrice(price: number, confidence: number = 0.01, slot?: number): void {
    const ts = Date.now();
    const effectiveSlot = slot !== undefined ? slot : this.currentSlot;
    
    const data: PriceData = {
      price,
      confidence,
      timestamp: ts,
    };
    
    this.priceHistory.push(data);
    // Keep only last 1000 entries for memory
    if (this.priceHistory.length > 1000) {
      this.priceHistory.shift();
    }
    
    // Simulate oracle update
    this.oracle.setPrice(price, confidence);
    this.currentSlot = effectiveSlot + 1;
  }

  public injectLagPrice(price: number, confidence: number = 0.01): void {
    const laggedSlot = Math.max(0, this.currentSlot - this.lagSlots);
    this.setPrice(price, confidence, laggedSlot);
  }

  public getPriceHistory(): PriceData[] {
    return [...this.priceHistory];
  }

  public getCurrentLag(): number {
    return this.lagSlots;
  }

  public getCurrentSlot(): number {
    return this.currentSlot;
  }

  public advanceSlot(slots: number = 1): void {
    this.currentSlot += slots;
  }

  public setLag(newLagSlots: number): void {
    this.lagSlots = newLagSlots;
  }
}

export function createLagInjector(oracle: TestOracle, initialLagSlots: number = 90): LagInjector {
  return new LagInjector(oracle, initialLagSlots);
}
