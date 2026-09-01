import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { PriceData } from "./oracle-utils";

export interface TestOracle {
  publicKey: PublicKey;
  setPrice: (price: number, conf: number, slot: number) => Promise<void>;
}

export class LagInjector {
  private connection: Connection;
  private programId: PublicKey;
  private oracle: TestOracle;
  private lagSlots: number;
  private priceHistory: Array<{ price: number; slot: number; conf: number }> = [];
  private currentSlot = 0;

  constructor(
    connection: Connection,
    programId: PublicKey,
    oracle: TestOracle,
    lagSeconds: number = 45
  ) {
    this.connection = connection;
    this.programId = programId;
    this.oracle = oracle;
    this.lagSlots = Math.floor(lagSeconds * 2); // ~2 slots per second on test validator
  }

  async advanceSlot(count: number = 1): Promise<number> {
    this.currentSlot += count;
    return this.currentSlot;
  }

  getCurrentSlot(): number {
    return this.currentSlot;
  }

  pushPrice(price: number, conf: number = 0.1): void {
    this.priceHistory.push({
      price,
      slot: this.currentSlot,
      conf,
    });
    // keep only last 1000 samples
    if (this.priceHistory.length > 1000) {
      this.priceHistory.shift();
    }
  }

  async injectLagPrice(): Promise<void> {
    const targetSlot = this.currentSlot - this.lagSlots;
    if (targetSlot < 0) {
      // not enough history yet - use latest price
      if (this.priceHistory.length > 0) {
        const latest = this.priceHistory[this.priceHistory.length - 1];
        await this.oracle.setPrice(latest.price, latest.conf, this.currentSlot);
      }
      return;
    }

    // find price closest to (but not after) targetSlot
    let best = this.priceHistory[0];
    for (const p of this.priceHistory) {
      if (p.slot <= targetSlot && p.slot > best.slot) {
        best = p;
      }
    }

    await this.oracle.setPrice(best.price, best.conf, this.currentSlot);
  }

  // replay a price series with lag
  async replaySeries(prices: number[], slotsPerTick: number = 4): Promise<void> {
    for (let i = 0; i < prices.length; i++) {
      this.pushPrice(prices[i]);
      await this.advanceSlot(slotsPerTick);
      await this.injectLagPrice();
    }
  }
}

export function createLagInjector(
  connection: Connection,
  programId: PublicKey,
  oracle: TestOracle,
  lagSeconds: number = 45
): LagInjector {
  return new LagInjector(connection, programId, oracle, lagSeconds);
}
