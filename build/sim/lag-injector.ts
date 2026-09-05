import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export interface PriceData {
  price: number;
  confidence: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  startSlot: number;
}

export interface LagInjectorConfig {
  oracleLagSlots: number;
  jitoMint: PublicKey;
  testValidator: any; // Anchor TestValidator or similar
}

export class LagInjector {
  private config: LagInjectorConfig;
  private historicalSeries: HistoricalPriceSeries[] = [];
  private currentIndex: number = 0;
  private lastInjectedSlot: number = 0;

  constructor(config: LagInjectorConfig) {
    this.config = config;
    this.historicalSeries = this.loadHistoricalJitoSeries();
  }

  private loadHistoricalJitoSeries(): HistoricalPriceSeries[] {
    // Replay of last three JitoSOL depeg events (realistic synthetic data)
    return [
      {
        startSlot: 100000,
        prices: [
          { price: 0.98, confidence: 0.01, timestamp: Date.now() - 3600000 },
          { price: 0.95, confidence: 0.02, timestamp: Date.now() - 2700000 },
          { price: 0.92, confidence: 0.015, timestamp: Date.now() - 1800000 },
          { price: 0.89, confidence: 0.01, timestamp: Date.now() - 900000 },
          { price: 0.87, confidence: 0.012, timestamp: Date.now() - 300000 },
        ],
      },
      {
        startSlot: 200000,
        prices: [
          { price: 1.02, confidence: 0.008, timestamp: Date.now() - 7200000 },
          { price: 0.97, confidence: 0.009, timestamp: Date.now() - 6300000 },
          { price: 0.94, confidence: 0.011, timestamp: Date.now() - 5400000 },
          { price: 0.91, confidence: 0.013, timestamp: Date.now() - 4500000 },
        ],
      },
      {
        startSlot: 300000,
        prices: [
          { price: 0.99, confidence: 0.007, timestamp: Date.now() - 10800000 },
          { price: 0.96, confidence: 0.01, timestamp: Date.now() - 9900000 },
          { price: 0.93, confidence: 0.014, timestamp: Date.now() - 9000000 },
          { price: 0.88, confidence: 0.016, timestamp: Date.now() - 8100000 },
          { price: 0.85, confidence: 0.02, timestamp: Date.now() - 7200000 },
        ],
      },
    ];
  }

  public async injectLag(slot: number): Promise<PriceData | null> {
    const targetSlot = slot - this.config.oracleLagSlots;
    if (targetSlot <= this.lastInjectedSlot) {
      return null;
    }

    const series = this.historicalSeries[this.currentIndex % this.historicalSeries.length];
    const priceIndex = Math.floor((targetSlot - series.startSlot) / 100);
    if (priceIndex < 0 || priceIndex >= series.prices.length) {
      this.currentIndex++;
      return null;
    }

    const price = series.prices[priceIndex];
    this.lastInjectedSlot = targetSlot;
    return { ...price, timestamp: Date.now() };
  }

  public advanceSeries(): void {
    this.currentIndex++;
  }

  public getCurrentLagMs(): number {
    return this.config.oracleLagSlots * 400; // ~400ms per slot
  }
}

export function getHistoricalJitoPrices(): HistoricalPriceSeries[] {
  // Used by tick-runner to seed checker
  const injector = new LagInjector({
    oracleLagSlots: 112, // ~45s target
    jitoMint: new PublicKey("J1toso1uCk3RLmP1m2t8b4v2v5fY5fY5fY5fY5fY5f"), // placeholder
    testValidator: null as any,
  });
  return injector["historicalSeries"]; // internal access for sim
}
