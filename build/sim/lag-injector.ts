import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { PriceData } from "./oracle-utils";

export interface TestOracle {
  pubkey: PublicKey;
  setPrice: (price: number, conf: number, slot: number) => Promise<void>;
  injectLagPrice: (price: number, slot: number) => Promise<void>;
  getPriceHistory: () => PriceData[];
  reset: () => void;
}

export class LagInjector implements TestOracle {
  pubkey: PublicKey;
  private history: PriceData[] = [];
  private lagSlots: number = 90; // ~45s at 500ms/slot target

  constructor() {
    this.pubkey = Keypair.generate().publicKey;
  }

  async setPrice(price: number, conf: number, slot: number): Promise<void> {
    this.history.push({
      price: Math.floor(price * 1_000_000),
      confidence: Math.floor(conf * 1_000_000),
      timestamp: Date.now(),
    });
  }

  async injectLagPrice(price: number, slot: number): Promise<void> {
    const laggedSlot = slot - this.lagSlots;
    this.history.push({
      price: Math.floor(price * 1_000_000),
      confidence: Math.floor(0.02 * 1_000_000),
      timestamp: Date.now(),
    });
  }

  getPriceHistory(): PriceData[] {
    return [...this.history];
  }

  reset(): void {
    this.history = [];
  }
}

export { LagInjector as default };
export type { PriceData };
