import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { OracleUtils, PriceData } from "./oracle-utils";

export interface JitoPricePoint {
  price: number;
  slot: number;
  timestamp: number;
}

export class LagInjector {
  private oracleUtils: OracleUtils;
  private connection: Connection;
  private oraclePubkey: PublicKey;
  private lagSlots: number;
  private priceHistory: JitoPricePoint[] = [];
  private lastInjectedSlot = 0;

  constructor(
    connection: Connection,
    oraclePubkey: PublicKey,
    lagSeconds: number = 45
  ) {
    this.connection = connection;
    this.oraclePubkey = oraclePubkey;
    this.oracleUtils = new OracleUtils(connection, oraclePubkey);
    this.lagSlots = Math.floor((lagSeconds * 2)); // ~2 slots per second on devnet/test
  }

  async loadHistory(history: JitoPricePoint[]): Promise<void> {
    this.priceHistory = [...history].sort((a, b) => a.slot - b.slot);
    this.lastInjectedSlot = 0;
  }

  async injectLag(currentSlot: number): Promise<void> {
    if (this.priceHistory.length === 0) {
      return;
    }

    const targetSlot = currentSlot - this.lagSlots;
    if (targetSlot <= this.lastInjectedSlot) {
      return;
    }

    // Find the latest price point that is at or before the lagged slot
    let priceToInject: JitoPricePoint | null = null;
    for (let i = this.priceHistory.length - 1; i >= 0; i--) {
      if (this.priceHistory[i].slot <= targetSlot) {
        priceToInject = this.priceHistory[i];
        break;
      }
    }

    if (!priceToInject) {
      return;
    }

    const priceData: PriceData = {
      price: priceToInject.price,
      confidence: 0.01,
      timestamp: priceToInject.timestamp,
    };

    await this.oracleUtils.setPrice(priceData);
    this.lastInjectedSlot = priceToInject.slot;
  }

  getCurrentLagSlots(): number {
    return this.lagSlots;
  }

  async getLatestOraclePrice(): Promise<PriceData | null> {
    return this.oracleUtils.getLatestPrice();
  }
}
