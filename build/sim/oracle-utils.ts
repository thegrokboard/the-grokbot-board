// build/sim/oracle-utils.ts
// Pure TypeScript utilities for the JitoSOL depeg simulation.
// Defines minimal PriceData (price + timestamp only) and the shared TestOracle
// interface. Provides deterministic historical replay data for the last three
// known Jito depeg episodes. No on-chain or RPC calls; everything is static
// for reproducible lag-injection and TWAP checks.

export interface PriceData {
  price: number;      // price in USD (e.g. 0.92)
  timestamp: number;  // Unix timestamp in seconds
}

export interface TestOracle {
  getPriceAt(ts: number): PriceData | null;
  getHistoricalPrices(): PriceData[];
  injectLag(lagMs: number): void;
}

export class MockOracle implements TestOracle {
  private basePrices: PriceData[];
  private lagMs: number = 0;

  constructor(initialPrices: PriceData[]) {
    this.basePrices = [...initialPrices].sort((a, b) => a.timestamp - b.timestamp);
  }

  injectLag(lagMs: number): void {
    this.lagMs = lagMs;
  }

  getPriceAt(ts: number): PriceData | null {
    const effectiveTs = ts - Math.floor(this.lagMs / 1000);
    for (let i = this.basePrices.length - 1; i >= 0; i--) {
      if (this.basePrices[i].timestamp <= effectiveTs) {
        return this.basePrices[i];
      }
    }
    return this.basePrices.length > 0 ? this.basePrices[0] : null;
  }

  getHistoricalPrices(): PriceData[] {
    return [...this.basePrices];
  }
}

// Last three major JitoSOL depeg episodes (synthetic but realistic).
// Each series is ~15 minutes of 1-second price ticks around the depeg event.
const DEPEG_SERIES_1: PriceData[] = Array.from({ length: 900 }, (_, i) => ({
  timestamp: 1693526400 + i,
  price: i < 300 ? 1.0 : i < 450 ? 0.98 - (i - 300) * 0.0004 : 0.92 + (i - 450) * 0.0001,
}));

const DEPEG_SERIES_2: PriceData[] = Array.from({ length: 900 }, (_, i) => ({
  timestamp: 1700000000 + i,
  price: i < 200 ? 1.0 : i < 500 ? 0.95 - (i - 200) * 0.0003 : Math.max(0.85, 0.95 - (i - 500) * 0.00005),
}));

const DEPEG_SERIES_3: PriceData[] = Array.from({ length: 900 }, (_, i) => ({
  timestamp: 1705000000 + i,
  price: i < 250 ? 1.0 : i < 600 ? 0.97 - (i - 250) * 0.00035 : 0.88 + (i - 600) * 0.0002,
}));

const ALL_HISTORICAL_PRICES: PriceData[] = [
  ...DEPEG_SERIES_1,
  ...DEPEG_SERIES_2,
  ...DEPEG_SERIES_3,
].sort((a, b) => a.timestamp - b.timestamp);

export function getHistoricalJitoPrices(): PriceData[] {
  return ALL_HISTORICAL_PRICES;
}

export function createTestOracle(): TestOracle {
  return new MockOracle(getHistoricalJitoPrices());
}

// 15-second TWAP false-positive detector.
// Returns true if the 15s TWAP would have falsely triggered the circuit breaker
// under the injected lag. Uses only the exported PriceData shape.
export function checkTWAPFalsePositive(
  prices: PriceData[],
  lagMs: number = 45000,
  twapThreshold: number = 0.97
): boolean {
  if (prices.length < 16) return false;

  const sorted = [...prices].sort((a, b) => a.timestamp - b.timestamp);
  let falsePositiveCount = 0;

  for (let i = 15; i < sorted.length; i++) {
    const window = sorted.slice(i - 15, i + 1);
    const sum = window.reduce((acc, p) => acc + p.price, 0);
    const twap = sum / window.length;
    const currentPrice = sorted[i].price;

    // Simulate lag: the oracle price the program would see is delayed
    const laggedIndex = Math.max(0, i - Math.floor(lagMs / (sorted[1].timestamp - sorted[0].timestamp)));
    const oraclePrice = sorted[laggedIndex].price;

    if (twap < twapThreshold && oraclePrice >= twapThreshold) {
      falsePositiveCount++;
    }
  }

  return falsePositiveCount > 5; // more than 5 false triggers in the series
}

// Re-export for backward compatibility with tick-runner.ts
export { checkTWAPFalsePositive as checkTWAPFalsePositive };
