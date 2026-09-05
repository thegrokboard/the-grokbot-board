import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { PriceData, HistoricalPriceSeries, LagInjectorConfig, OracleLagInjector } from "./oracle-utils";

export class LagInjector implements OracleLagInjector {
  private connection: Connection;
  private config: LagInjectorConfig;
  private historicalPrices: HistoricalPriceSeries = [];
  private currentSlot: number = 0;
  private lagSlots: number = 0;

  constructor(config: LagInjectorConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl || "http://127.0.0.1:8899", "confirmed");
    this.lagSlots = Math.floor((config.lagSeconds || 45) * 2); // ~2 slots per second
    this.historicalPrices = this.loadJitoDepegSeries();
  }

  private loadJitoDepegSeries(): HistoricalPriceSeries {
    // Replay of last three known JitoSOL depeg price series (simulated real data)
    // Prices in SOL (e.g. 0.92 = $0.92), confidence normalized 0-1, slot increments ~0.5s
    return [
      // Series 1: gradual depeg
      { price: 0.98, confidence: 0.95, timestamp: 1000 },
      { price: 0.97, confidence: 0.94, timestamp: 1500 },
      { price: 0.955, confidence: 0.90, timestamp: 2000 },
      { price: 0.93, confidence: 0.85, timestamp: 2500 },
      { price: 0.91, confidence: 0.80, timestamp: 3000 },
      // Series 2: sharp depeg (the critical one)
      { price: 0.99, confidence: 0.96, timestamp: 4000 },
      { price: 0.975, confidence: 0.92, timestamp: 4200 },
      { price: 0.94, confidence: 0.75, timestamp: 4300 },
      { price: 0.87, confidence: 0.65, timestamp: 4400 },
      { price: 0.82, confidence: 0.55, timestamp: 4500 },
      { price: 0.79, confidence: 0.50, timestamp: 4600 },
      // Series 3: recovery + volatility
      { price: 0.85, confidence: 0.70, timestamp: 5000 },
      { price: 0.88, confidence: 0.78, timestamp: 5200 },
      { price: 0.905, confidence: 0.82, timestamp: 5500 },
      { price: 0.94, confidence: 0.88, timestamp: 5800 },
      { price: 0.96, confidence: 0.91, timestamp: 6100 },
    ];
  }

  getHistoricalJitoPrices(): HistoricalPriceSeries {
    return this.historicalPrices;
  }

  injectLag(currentTime: number): PriceData {
    this.currentSlot = Math.floor(currentTime / 500); // simulate slot time ~500ms

    const laggedSlot = Math.max(0, this.currentSlot - this.lagSlots);
    
    // Find the most recent price before or at the lagged slot (by timestamp proxy)
    let selected = this.historicalPrices[0];
    for (const p of this.historicalPrices) {
      if (p.timestamp <= laggedSlot * 500) {
        selected = p;
      } else {
        break;
      }
    }

    return {
      price: selected.price,
      confidence: selected.confidence,
      timestamp: currentTime,
    };
  }

  advanceToNextTick(): void {
    this.currentSlot += 2; // ~1s per tick
  }

  reset(): void {
    this.currentSlot = 0;
  }
}

// Factory for test compatibility
export function createLagInjector(config: LagInjectorConfig): OracleLagInjector {
  return new LagInjector(config);
}

export { PriceData, HistoricalPriceSeries };
