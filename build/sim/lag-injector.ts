import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { OracleUtils, PriceData } from "./oracle-utils";

export class LagInjector {
  private oracleUtils: OracleUtils;
  private lagSlots: number;
  private connection: Connection;
  private programId: PublicKey;
  private priceHistory: PriceData[] = [];

  constructor(
    connection: Connection,
    programId: PublicKey,
    lagSeconds: number = 45
  ) {
    this.connection = connection;
    this.programId = programId;
    this.lagSlots = Math.floor(lagSeconds * 2); // ~2 slots per second
    this.oracleUtils = new OracleUtils(connection, programId);
  }

  async loadPriceHistory(prices: Array<{ price: number; confidence: number; timestamp: number }>): Promise<void> {
    this.priceHistory = prices.map((p, i) => ({
      price: p.price,
      confidence: p.confidence,
      timestamp: p.timestamp,
      slot: i * 2, // simulate increasing slots
    }));
  }

  async injectPriceWithLag(currentSlot: number): Promise<void> {
    const targetSlot = currentSlot - this.lagSlots;
    if (targetSlot < 0 || this.priceHistory.length === 0) {
      console.log(`LagInjector: no historical price for slot ${targetSlot}, using latest`);
      const latest = this.priceHistory[this.priceHistory.length - 1];
      if (latest) {
        await this.oracleUtils.setPrice(latest.price, latest.confidence);
      }
      return;
    }

    // find closest price by slot
    let best = this.priceHistory[0];
    for (const p of this.priceHistory) {
      if (Math.abs(p.slot - targetSlot) < Math.abs(best.slot - targetSlot)) {
        best = p;
      }
    }

    console.log(`LagInjector: injecting lagged price ${best.price} (slot ${best.slot}) at current slot ${currentSlot}`);
    await this.oracleUtils.setPrice(best.price, best.confidence);
  }

  getCurrentLagSlots(): number {
    return this.lagSlots;
  }
}
