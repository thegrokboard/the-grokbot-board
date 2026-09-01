import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { PriceData } from "./oracle-utils";

export interface LagConfig {
  lagSlots: number;
  targetLagMs: number;
}

export class TestOracle {
  private currentPrice: number = 1.0;
  private confidence: number = 0.01;
  private priceHistory: PriceData[] = [];
  private slot: number = 0;
  private lagConfig: LagConfig;

  constructor(lagConfig: LagConfig = { lagSlots: 90, targetLagMs: 45000 }) {
    this.lagConfig = lagConfig;
  }

  public setPrice(price: number, conf: number = 0.01): void {
    this.currentPrice = price;
    this.confidence = conf;
    this.slot += 1;
    this.priceHistory.push({
      price: this.currentPrice,
      conf: this.confidence,
      slot: this.slot,
    });
  }

  public injectLagPrice(price: number, conf: number = 0.01): void {
    this.slot += 1;
    this.priceHistory.push({
      price,
      conf,
      slot: this.slot - this.lagConfig.lagSlots,
    });
    this.currentPrice = price;
    this.confidence = conf;
  }

  public getPriceHistory(): PriceData[] {
    return [...this.priceHistory];
  }

  public getCurrentPrice(): number {
    return this.currentPrice;
  }

  public getCurrentConfidence(): number {
    return this.confidence;
  }

  public getCurrentSlot(): number {
    return this.slot;
  }

  public advanceSlot(slots: number = 1): void {
    this.slot += slots;
  }
}

export function createLagInjector(lagSlots: number = 90): TestOracle {
  return new TestOracle({ lagSlots, targetLagMs: 45000 });
}
