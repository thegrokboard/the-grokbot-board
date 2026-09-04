import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";

export interface HistoricalPriceSeries {
  prices: PriceData[];
  startSlot: number;
  currentIndex: number;
}

export interface LagInjectorConfig {
  lagSlots: number;
  rpcUrl: string;
  oracleProgramId?: PublicKey;
  priceFeed?: PublicKey;
}

export class LagInjector {
  private connection: Connection;
  private lagSlots: number;
  private series: HistoricalPriceSeries | null = null;
  private oracleProgramId: PublicKey;
  private priceFeed: PublicKey;

  constructor(config: LagInjectorConfig) {
    this.connection = new Connection(config.rpcUrl, "confirmed");
    this.lagSlots = config.lagSlots;
    this.oracleProgramId = config.oracleProgramId || new PublicKey("7y4vF4vKz4vF4vKz4vF4vKz4vF4vKz4vF4vKz4vF4vK"); // placeholder
    this.priceFeed = config.priceFeed || new PublicKey("J1toso1uCk3RLmjr7nG2g4b4vF4vKz4vF4vKz4vF4vK"); // placeholder for jitoSOL oracle
  }

  async loadSeries(): Promise<void> {
    const rawPrices = await getHistoricalJitoPrices();
    const prices: PriceData[] = rawPrices.map(p => ({
      price: p.price,
      confidence: p.confidence || 0,
      timestamp: p.timestamp || Math.floor(Date.now() / 1000),
    }));
    this.series = {
      prices,
      startSlot: 100000000, // arbitrary genesis for sim
      currentIndex: 0,
    };
  }

  getCurrentPrice(lagOverride?: number): PriceData | null {
    if (!this.series || this.series.prices.length === 0) return null;
    const effectiveLag = lagOverride !== undefined ? lagOverride : this.lagSlots;
    const laggedIndex = Math.max(0, this.series.currentIndex - effectiveLag);
    return this.series.prices[laggedIndex];
  }

  async injectLag(priceAccount: PublicKey, lagSlots: number = 45): Promise<string> {
    if (!this.series) {
      await this.loadSeries();
    }
    if (!this.series || this.series.prices.length === 0) {
      throw new Error("No price series loaded");
    }

    const slot = await this.connection.getSlot();
    const targetIndex = Math.min(this.series.currentIndex, this.series.prices.length - 1);
    const priceToInject = this.series.prices[targetIndex];

    // Simulate updating an oracle account with lagged price (in real sim this would use a mock oracle program)
    const ixData = Buffer.from([
      0, // update discriminator stub
      ...new anchor.BN(priceToInject.price).toArray("le", 8),
      ...new anchor.BN(priceToInject.confidence).toArray("le", 8),
      ...new anchor.BN(priceToInject.timestamp).toArray("le", 8),
    ]);

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: Keypair.generate().publicKey, // dummy for sim harness
        toPubkey: priceAccount,
        lamports: 0,
      })
    );
    // In full harness this would call the real oracle update with injected data; here we simulate success
    this.series.currentIndex = (this.series.currentIndex + 1) % this.series.prices.length;
    return `sim-tx-${slot}-${targetIndex}`;
  }

  getSeriesLength(): number {
    return this.series ? this.series.prices.length : 0;
  }

  getSeriesSlice(start: number, end: number): PriceData[] {
    if (!this.series) return [];
    return this.series.prices.slice(start, end);
  }

  reset(): void {
    if (this.series) {
      this.series.currentIndex = 0;
    }
  }
}

export default LagInjector;
