import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { OracleUtils, PriceData } from "./oracle-utils";

export interface JitoPricePoint {
  slot: number;
  price: number; // in USD, scaled to 1e9 for precision
  confidence: number;
  timestamp: number;
}

export class LagInjector {
  private oracleUtils: OracleUtils;
  private connection: Connection;
  private lagSlots: number;
  private priceHistory: JitoPricePoint[] = [];
  private lastInjectedSlot: number = 0;

  constructor(
    connection: Connection,
    oracleProgramId: PublicKey,
    jitoFeedPubkey: PublicKey,
    targetLagSeconds: number = 45
  ) {
    this.connection = connection;
    this.oracleUtils = new OracleUtils(connection, oracleProgramId, jitoFeedPubkey);
    this.lagSlots = Math.floor(targetLagSeconds * 2); // approx 2 slots per second on test validator
  }

  public loadPriceSeries(series: JitoPricePoint[]): void {
    this.priceHistory = [...series].sort((a, b) => a.slot - b.slot);
    this.lastInjectedSlot = 0;
  }

  public async injectLag(currentSlot: number): Promise<void> {
    if (this.priceHistory.length === 0) {
      throw new Error("No price series loaded");
    }

    const targetSlot = Math.max(0, currentSlot - this.lagSlots);
    const priceToInject = this.findPriceAtOrBefore(targetSlot);

    if (!priceToInject) {
      console.warn(`No historical price found for target slot ${targetSlot}`);
      return;
    }

    if (priceToInject.slot === this.lastInjectedSlot) {
      return; // already injected this price
    }

    const priceData: PriceData = {
      price: priceToInject.price,
      confidence: priceToInject.confidence,
      timestamp: priceToInject.timestamp,
    };

    await this.oracleUtils.updatePrice(priceData);
    this.lastInjectedSlot = priceToInject.slot;

    console.log(`Injected lagged JitoSOL price at slot ${currentSlot}: $${(priceToInject.price / 1e9).toFixed(4)} (lagged from slot ${priceToInject.slot})`);
  }

  private findPriceAtOrBefore(targetSlot: number): JitoPricePoint | null {
    let closest: JitoPricePoint | null = null;
    for (const point of this.priceHistory) {
      if (point.slot > targetSlot) break;
      if (!closest || point.slot > closest.slot) {
        closest = point;
      }
    }
    return closest;
  }

  public getCurrentLagSlots(): number {
    return this.lagSlots;
  }

  public setLagSlots(slots: number): void {
    this.lagSlots = slots;
  }
}
