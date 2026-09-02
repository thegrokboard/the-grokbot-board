import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface TWAPConfig {
  windowSeconds: number;
  thresholdPercent: number;
  minObservations: number;
}

export class TestOracle {
  private prices: PriceData[] = [];
  private lagSeconds: number = 0;

  constructor(initialPrices: PriceData[] = []) {
    this.prices = [...initialPrices];
  }

  addPrice(price: number, timestamp: number): void {
    this.prices.push({ price, timestamp });
    this.prices.sort((a, b) => a.timestamp - b.timestamp);
  }

  getLatestPrice(): PriceData | null {
    if (this.prices.length === 0) return null;
    return this.prices[this.prices.length - 1];
  }

  getHistoricalPrices(): PriceData[] {
    return [...this.prices];
  }

  setLag(lag: number): void {
    this.lagSeconds = lag;
  }

  getLag(): number {
    return this.lagSeconds;
  }
}

export class LagInjector {
  private oracle: TestOracle;
  private lagSeconds: number;

  constructor(oracle: TestOracle, lagSeconds: number = 45) {
    this.oracle = oracle;
    this.lagSeconds = lagSeconds;
  }

  injectLag(currentSlot: number, slotDurationMs: number = 400): PriceData | null {
    const now = Date.now();
    const lagMs = this.lagSeconds * 1000;
    const laggedTime = now - lagMs;
    const laggedSlot = Math.floor(currentSlot - (lagMs / slotDurationMs));

    const prices = this.oracle.getHistoricalPrices();
    for (let i = prices.length - 1; i >= 0; i--) {
      if (prices[i].timestamp <= laggedTime) {
        return prices[i];
      }
    }
    return prices.length > 0 ? prices[0] : null;
  }

  getOracle(): TestOracle {
    return this.oracle;
  }
}

export function getHistoricalJitoPrices(): PriceData[] {
  // Last three known JitoSOL depeg series (normalized timestamps to relative seconds)
  // Series 1: minor depeg ~0.98
  // Series 2: sharp drop to 0.92 then recovery
  // Series 3: prolonged depeg around 0.95
  const baseTime = Date.now() - 3600 * 1000; // 1 hour ago
  const series: PriceData[] = [
    // Series 1
    { price: 0.995, timestamp: baseTime + 1000 },
    { price: 0.982, timestamp: baseTime + 5000 },
    { price: 0.978, timestamp: baseTime + 12000 },
    { price: 0.990, timestamp: baseTime + 25000 },
    // Series 2 - sharp depeg
    { price: 0.965, timestamp: baseTime + 40000 },
    { price: 0.931, timestamp: baseTime + 52000 },
    { price: 0.922, timestamp: baseTime + 61000 },
    { price: 0.945, timestamp: baseTime + 75000 },
    { price: 0.978, timestamp: baseTime + 90000 },
    // Series 3 - prolonged
    { price: 0.961, timestamp: baseTime + 110000 },
    { price: 0.952, timestamp: baseTime + 125000 },
    { price: 0.948, timestamp: baseTime + 140000 },
    { price: 0.955, timestamp: baseTime + 170000 },
    { price: 0.972, timestamp: baseTime + 200000 },
  ];
  return series;
}

export function calculateTWAP(prices: PriceData[], windowSeconds: number, now: number): number | null {
  const windowStart = now - windowSeconds * 1000;
  const relevant = prices.filter(p => p.timestamp >= windowStart && p.timestamp <= now);
  
  if (relevant.length < 2) return null;
  
  let weightedSum = 0;
  let totalWeight = 0;
  let prevTime = relevant[0].timestamp;
  
  for (let i = 1; i < relevant.length; i++) {
    const interval = (relevant[i].timestamp - prevTime) / 1000;
    const avgPrice = (relevant[i - 1].price + relevant[i].price) / 2;
    weightedSum += avgPrice * interval;
    totalWeight += interval;
    prevTime = relevant[i].timestamp;
  }
  
  if (totalWeight === 0) return null;
  return weightedSum / totalWeight;
}

export function checkTWAPFalsePositive(
  prices: PriceData[],
  config: TWAPConfig,
  currentPrice: number,
  now: number
): boolean {
  const twap = calculateTWAP(prices, config.windowSeconds, now);
  if (twap === null) return false;
  
  const deviation = Math.abs((currentPrice - twap) / twap) * 100;
  const isDepeg = deviation > config.thresholdPercent;
  
  // False positive if depeg detected but recent prices show quick recovery (within minObservations)
  if (isDepeg) {
    const recent = prices.filter(p => p.timestamp > now - config.windowSeconds * 1000);
    if (recent.length >= config.minObservations) {
      const lastFew = recent.slice(-3);
      const recovering = lastFew.some(p => Math.abs((p.price - 1.0) / 1.0) * 100 < config.thresholdPercent / 2);
      return recovering;
    }
  }
  return false;
}
