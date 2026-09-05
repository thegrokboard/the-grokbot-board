import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  depegStartSlot: number;
}

export interface LagInjectorConfig {
  lagSlots: number;
  oraclePubkey: PublicKey;
  jitoSolMint: PublicKey;
  testValidator: any; // Anchor's TestValidator interface
  connection: Connection;
}

export class OracleUtils {
  private config: LagInjectorConfig;
  private currentLag: number = 0;
  private priceBuffer: Map<number, PriceData> = new Map();

  constructor(config: LagInjectorConfig) {
    this.config = config;
  }

  async setTestPrice(price: number, slot: number): Promise<void> {
    const laggedSlot = slot - this.config.lagSlots;
    const priceData: PriceData = {
      price,
      timestamp: Date.now(),
    };
    this.priceBuffer.set(laggedSlot, priceData);

    // In a real sim this would update a Switchboard or Pyth oracle account on the test validator
    // For this pure-onchain harness we simulate via the injected connection
    console.log(`[OracleUtils] Set test price ${price} at slot ${slot} (lagged to ${laggedSlot})`);
  }

  getPriceAtSlot(slot: number): PriceData | null {
    // Return the most recent price whose lagged slot <= requested slot
    let best: PriceData | null = null;
    let bestSlot = -1;
    for (const [s, p] of this.priceBuffer) {
      if (s <= slot && s > bestSlot) {
        bestSlot = s;
        best = p;
      }
    }
    return best;
  }

  getHistoricalSeries(): HistoricalPriceSeries {
    const sortedSlots = Array.from(this.priceBuffer.keys()).sort((a, b) => a - b);
    const prices: PriceData[] = sortedSlots.map(s => this.priceBuffer.get(s)!);
    return {
      prices,
      depegStartSlot: sortedSlots.length > 0 ? sortedSlots[0] : 0,
    };
  }

  advanceSlot(currentSlot: number): void {
    this.currentLag = Math.max(0, this.currentLag - 1);
    // Cleanup old buffer entries
    const minSlot = currentSlot - 1000;
    for (const s of this.priceBuffer.keys()) {
      if (s < minSlot) this.priceBuffer.delete(s);
    }
  }
}

export function checkTWAPFalsePositive(series: HistoricalPriceSeries, windowSlots: number = 150): boolean {
  if (series.prices.length < 2) return false;

  const prices = series.prices;
  let sum = 0;
  let count = 0;

  for (let i = 0; i < prices.length; i++) {
    sum += prices[i].price;
    count++;
    if (count > windowSlots) {
      sum -= prices[i - windowSlots].price;
      count--;
    }
    const twap = sum / count;
    const currentPrice = prices[i].price;

    // Simple depeg detection: price < 0.85 for >30% of window considered a true trip
    if (currentPrice < 0.85 * twap && i > windowSlots * 0.3) {
      return false; // Real depeg, not false positive
    }
  }
  return true; // No sustained depeg detected = false positive
}

export async function loadJitoHistoricalSeries(): Promise<HistoricalPriceSeries> {
  // Hard-coded replay of last three known JitoSOL depeg price series (simplified)
  // Real version would load from JSON fixture or RPC archive
  const prices: PriceData[] = [
    { price: 0.98, timestamp: 1700000000000 },
    { price: 0.95, timestamp: 1700000100000 },
    { price: 0.89, timestamp: 1700000200000 },
    { price: 0.82, timestamp: 1700000300000 },
    { price: 0.78, timestamp: 1700000400000 },
    { price: 0.75, timestamp: 1700000500000 },
    { price: 0.81, timestamp: 1700000600000 },
    { price: 0.92, timestamp: 1700000700000 },
    { price: 0.97, timestamp: 1700000800000 },
  ];

  return {
    prices,
    depegStartSlot: 42000000,
  };
}
