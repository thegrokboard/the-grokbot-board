import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import { getHistoricalJitoPrices, PriceData, HistoricalPriceSeries } from "./oracle-utils";
import { TWAPConfig } from "./twap-checker";

export interface LagInjectorConfig {
  lagSlots: number;
  oraclePubkey: PublicKey;
  payer: Keypair;
  connection: Connection;
  programId: PublicKey;
}

export class LagInjector {
  private config: LagInjectorConfig;
  private priceHistory: PriceData[] = [];
  private currentSlot = 0;
  private lastInjectedSlot = 0;

  constructor(config: LagInjectorConfig) {
    this.config = config;
    this.priceHistory = [];
  }

  async loadHistoricalData(): Promise<void> {
    const series: HistoricalPriceSeries = await getHistoricalJitoPrices();
    this.priceHistory = series.map((p: any) => ({
      price: p.price,
      confidence: p.confidence || 0.01,
      timestamp: p.timestamp,
      slot: p.slot || Math.floor(p.timestamp / 0.4), // approximate slot from timestamp if missing
    }));
    this.currentSlot = Math.max(...this.priceHistory.map(p => p.slot));
    this.lastInjectedSlot = this.currentSlot - this.config.lagSlots * 3; // start with buffer
  }

  async injectLag(targetLagSeconds: number = 45): Promise<void> {
    if (this.priceHistory.length === 0) {
      await this.loadHistoricalData();
    }

    const lagSlots = Math.floor(targetLagSeconds / 0.4); // ~400ms per slot
    const effectiveLag = Math.max(lagSlots, this.config.lagSlots);

    // Replay last 3 depeg events with lag
    const depegEvents = this.detectDepegEvents();
    for (const event of depegEvents) {
      const laggedSlot = event.slot + effectiveLag;
      await this.updateOracleAtSlot(laggedSlot, event.price, event.confidence);
      this.lastInjectedSlot = Math.max(this.lastInjectedSlot, laggedSlot);
    }

    // Advance to current simulated slot
    this.currentSlot = this.lastInjectedSlot + 50; // small buffer
  }

  private detectDepegEvents(): PriceData[] {
    const events: PriceData[] = [];
    let inDepeg = false;
    for (let i = 1; i < this.priceHistory.length; i++) {
      const prev = this.priceHistory[i - 1];
      const curr = this.priceHistory[i];
      const drop = (prev.price - curr.price) / prev.price;
      if (drop > 0.02 && !inDepeg) { // 2%+ drop
        inDepeg = true;
        events.push(curr);
      } else if (drop < 0.005) {
        inDepeg = false;
      }
      if (events.length >= 3) break;
    }
    return events.length > 3 ? events.slice(-3) : events;
  }

  private async updateOracleAtSlot(slot: number, price: number, confidence: number): Promise<void> {
    // Simulate oracle update by sending a transaction that would update a mock Switchboard-like account
    // In real test validator this would CPI or directly write to oracle account; here we just advance slot and log
    this.currentSlot = Math.max(this.currentSlot, slot);

    const recentBlockhash = (await this.config.connection.getLatestBlockhash()).blockhash;
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.config.payer.publicKey,
        toPubkey: this.config.payer.publicKey,
        lamports: 1, // no-op to advance slot with timestamp hint
      })
    );
    tx.recentBlockhash = recentBlockhash;
    tx.feePayer = this.config.payer.publicKey;
    await anchor.web3.sendAndConfirmTransaction(this.config.connection, tx, [this.config.payer], {
      commitment: "confirmed",
      skipPreflight: true,
    });

    // In full harness this would also update a mock oracle account with the lagged price
    console.log(`[LagInjector] Injected lagged price at slot ${slot}: $${price.toFixed(4)} (lag ~${Math.round((slot - (this.priceHistory.find(p => p.price === price)?.slot || 0)) * 0.4)}s)`);
  }

  getCurrentSlot(): number {
    return this.currentSlot;
  }

  getLastInjectedPrice(): PriceData | null {
    if (this.priceHistory.length === 0) return null;
    return this.priceHistory[this.priceHistory.length - 1];
  }

  // Public API used by tick-runner
  async simulateLag(targetLagSeconds: number = 45): Promise<void> {
    await this.injectLag(targetLagSeconds);
  }
}
