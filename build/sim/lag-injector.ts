import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { OracleUtils, PriceData } from "./oracle-utils";

export interface JitoPricePoint {
  timestamp: number;
  price: number;
}

export class LagInjector {
  private connection: Connection;
  private oracleUtils: OracleUtils;
  private lagSlots: number;
  private priceHistory: JitoPricePoint[] = [];
  private currentSlot: number = 0;
  private baseSlot: number = 0;

  constructor(
    connection: Connection,
    oracleProgramId: PublicKey,
    lagSeconds: number = 45,
    baseSlot: number = 0
  ) {
    this.connection = connection;
    this.oracleUtils = new OracleUtils(connection, oracleProgramId);
    this.lagSlots = Math.floor((lagSeconds * 2)); // ~2 slots per second on devnet/test
    this.baseSlot = baseSlot;
    this.currentSlot = baseSlot;
  }

  async loadPriceHistory(history: JitoPricePoint[]): Promise<void> {
    this.priceHistory = [...history].sort((a, b) => a.timestamp - b.timestamp);
    if (this.priceHistory.length > 0) {
      this.currentSlot = this.baseSlot + Math.floor((Date.now() - this.priceHistory[0].timestamp) / 500);
    }
  }

  getCurrentSlot(): number {
    return this.currentSlot;
  }

  async advanceSlot(steps: number = 1): Promise<void> {
    this.currentSlot += steps;
  }

  async injectLatestPrice(oracleAccount: PublicKey): Promise<void> {
    const effectiveSlot = this.currentSlot - this.lagSlots;
    const pricePoint = this.getPriceAtSlot(effectiveSlot);
    if (!pricePoint) {
      return;
    }

    const priceData: PriceData = {
      price: pricePoint.price,
      timestamp: new anchor.BN(pricePoint.timestamp),
    };

    await this.oracleUtils.updateOracle(oracleAccount, priceData);
  }

  private getPriceAtSlot(slot: number): JitoPricePoint | null {
    if (this.priceHistory.length === 0) return null;

    const targetTime = this.getTimestampForSlot(slot);
    // Find closest price point
    let closest = this.priceHistory[0];
    let minDiff = Math.abs(closest.timestamp - targetTime);

    for (const point of this.priceHistory) {
      const diff = Math.abs(point.timestamp - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = point;
      }
    }
    return closest;
  }

  private getTimestampForSlot(slot: number): number {
    // Simplified mapping: assume genesis at baseSlot ~0
    return Math.floor(Date.now() / 1000) - ((this.currentSlot - slot) * 0.5);
  }

  async replayLastThreeSeries(
    oracleAccount: PublicKey,
    tickIntervalMs: number = 15000
  ): Promise<void> {
    // Replay logic for last three known Jito depeg series (hardcoded sample for sim)
    const sampleSeries: JitoPricePoint[] = [
      // Series 1: minor depeg
      { timestamp: 1720000000, price: 0.98 },
      { timestamp: 1720000015, price: 0.97 },
      { timestamp: 1720000030, price: 0.95 },
      { timestamp: 1720000045, price: 0.92 },
      { timestamp: 1720000060, price: 0.90 },
      // Series 2: recovery
      { timestamp: 1720100000, price: 0.89 },
      { timestamp: 1720100015, price: 0.91 },
      { timestamp: 1720100030, price: 0.94 },
      { timestamp: 1720100045, price: 0.97 },
      { timestamp: 1720100060, price: 0.99 },
      // Series 3: severe depeg (breaker should trip)
      { timestamp: 1720200000, price: 0.98 },
      { timestamp: 1720200015, price: 0.85 },
      { timestamp: 1720200030, price: 0.72 },
      { timestamp: 1720200045, price: 0.68 },
      { timestamp: 1720200060, price: 0.65 },
    ];

    await this.loadPriceHistory(sampleSeries);

    // Drive replay with configurable tick
    for (let i = 0; i < 30; i++) { // simulate ~7.5 minutes of ticks
      await this.advanceSlot(4);
      await this.injectLatestPrice(oracleAccount);
      await new Promise((resolve) => setTimeout(resolve, tickIntervalMs / 4));
    }
  }
}
