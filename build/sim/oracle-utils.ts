import { PublicKey } from '@solana/web3.js';

export interface PriceData {
  price: number;
  timestamp: number;
}

export class OracleUtils {
  private prices: PriceData[] = [];
  private lagMs: number = 0;

  constructor(initialPrices: PriceData[] = []) {
    this.prices = [...initialPrices];
  }

  setLag(lagMs: number): void {
    this.lagMs = lagMs;
  }

  addPrice(price: number, timestamp: number): void {
    this.prices.push({ price, timestamp });
    // keep only last 1000 samples for memory
    if (this.prices.length > 1000) {
      this.prices.shift();
    }
  }

  getPriceAt(targetTimestamp: number): PriceData | null {
    if (this.prices.length === 0) return null;

    const laggedTimestamp = targetTimestamp - this.lagMs;
    
    // find latest price whose timestamp <= laggedTimestamp
    let best: PriceData | null = null;
    for (const p of this.prices) {
      if (p.timestamp <= laggedTimestamp) {
        if (!best || p.timestamp > best.timestamp) {
          best = p;
        }
      }
    }
    return best;
  }

  getHistoricalPrices(start: number, end: number): PriceData[] {
    return this.prices.filter(p => p.timestamp >= start && p.timestamp <= end);
  }

  // JitoSOL depeg price series (example values from last known depeg events)
  static getJitoDepegSeries(): PriceData[] {
    const base = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days ago
    return [
      { price: 0.98, timestamp: base + 3600000 },
      { price: 0.95, timestamp: base + 7200000 },
      { price: 0.92, timestamp: base + 10800000 },
      { price: 0.89, timestamp: base + 14400000 },
      { price: 0.85, timestamp: base + 18000000 },
      { price: 0.82, timestamp: base + 21600000 },
      { price: 0.88, timestamp: base + 25200000 },
      { price: 0.94, timestamp: base + 28800000 },
      { price: 0.97, timestamp: base + 32400000 },
      { price: 0.99, timestamp: base + 36000000 },
    ];
  }

  static replaySeries(lagMs: number = 45000): OracleUtils {
    const series = OracleUtils.getJitoDepegSeries();
    const oracle = new OracleUtils(series);
    oracle.setLag(lagMs);
    return oracle;
  }
}

// Re-export for convenience
export { OracleUtils as default };
