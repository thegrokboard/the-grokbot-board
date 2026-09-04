import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import { OracleUtils, PriceData } from "./oracle-utils";

export interface HistoricalPrice {
  price: number;
  confidence: number;
  timestamp: number;
}

export class LagInjector {
  private connection: Connection;
  private oracleUtils: OracleUtils;
  private lagSlots: number;
  private priceHistory: HistoricalPrice[] = [];
  private currentSlot: number = 0;

  constructor(connection: Connection, oracleUtils: OracleUtils, lagSeconds: number = 45) {
    this.connection = connection;
    this.oracleUtils = oracleUtils;
    // Approximate slots per second on test validator (2 slots/sec is common)
    this.lagSlots = Math.floor(lagSeconds * 2);
  }

  async loadHistoricalPrices(prices: HistoricalPrice[]): Promise<void> {
    this.priceHistory = [...prices].sort((a, b) => a.timestamp - b.timestamp);
    if (this.priceHistory.length > 0) {
      this.currentSlot = Math.floor(this.priceHistory[0].timestamp / 0.4); // rough inverse of 2.5s/slot
    }
  }

  async advanceToSlot(targetSlot: number): Promise<void> {
    this.currentSlot = targetSlot;
    // Replay any prices that should be visible now (accounting for lag)
    const visibleSlot = targetSlot - this.lagSlots;
    const visibleTime = visibleSlot * 0.4; // approximate ms per slot

    for (const price of this.priceHistory) {
      if (price.timestamp <= visibleTime) {
        const pd: PriceData = {
          price: price.price,
          timestamp: new anchor.BN(price.timestamp),
        };
        await this.oracleUtils.updateOracle(pd);
      } else {
        break;
      }
    }
  }

  getCurrentSlot(): number {
    return this.currentSlot;
  }

  async injectLag(price: number, confidence: number = 1.0): Promise<void> {
    const now = Date.now();
    const slotTime = this.currentSlot * 0.4 * 1000;
    const ts = Math.floor(slotTime / 1000);

    const pd: PriceData = {
      price: price,
      timestamp: new anchor.BN(ts),
    };

    await this.oracleUtils.updateOracle(pd);
    this.priceHistory.push({ price, confidence, timestamp: ts });
  }
}
