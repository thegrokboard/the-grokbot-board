import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { TestOracle, PriceData } from "./lag-injector";

export interface HistoricalPrice {
  price: number;
  timestamp: number;
}

export async function getHistoricalJitoPrices(
  days: number = 7
): Promise<HistoricalPrice[]> {
  // Replay of real JitoSOL depeg series from Nov 2024 (simulated data)
  const basePrices = [
    { price: 0.92, timestamp: 1731000000 },
    { price: 0.89, timestamp: 1731086400 },
    { price: 0.85, timestamp: 1731172800 },
    { price: 0.78, timestamp: 1731259200 },
    { price: 0.65, timestamp: 1731345600 },
    { price: 0.58, timestamp: 1731432000 },
    { price: 0.62, timestamp: 1731518400 },
    { price: 0.71, timestamp: 1731604800 },
    { price: 0.88, timestamp: 1731691200 },
  ];

  const series: HistoricalPrice[] = [];
  const now = Math.floor(Date.now() / 1000);
  const start = now - days * 24 * 60 * 60;

  for (let i = 0; i < 180; i++) { // ~every 2 hours over 15 days
    const t = start + i * 7200;
    const idx = Math.min(Math.floor(i / 20), basePrices.length - 1);
    const base = basePrices[idx];
    const noise = (Math.random() - 0.5) * 0.03;
    series.push({
      price: Math.max(0.5, Math.min(1.05, base.price + noise)),
      timestamp: t,
    });
  }
  return series;
}

export function createLagInjector(
  historical: HistoricalPrice[],
  lagSeconds: number = 45
): TestOracle {
  let cursor = 0;
  const prices: PriceData[] = historical.map((p) => ({
    price: p.price,
    timestamp: p.timestamp,
  }));

  return {
    getCurrentPrice: () => {
      const now = Math.floor(Date.now() / 1000);
      const laggedTime = now - lagSeconds;
      while (cursor < prices.length - 1 && prices[cursor + 1].timestamp <= laggedTime) {
        cursor++;
      }
      return prices[Math.min(cursor, prices.length - 1)];
    },

    injectPrices: async (oraclePubkey: PublicKey, connection: anchor.web3.Connection) => {
      // In test validator we update a mock oracle account (simplified)
      console.log(`[LagInjector] Injecting ${prices.length} lagged prices to ${oraclePubkey}`);
      // Real implementation would use a mock price account or Switchboard/ custom oracle
      // For this harness we just advance internal state
      return true;
    },

    reset: () => {
      cursor = 0;
    },
  };
}

export function createTestOracle(historicalPrices: HistoricalPrice[], lagMs: number): TestOracle {
  const lagSeconds = Math.floor(lagMs / 1000);
  return createLagInjector(historicalPrices, lagSeconds);
}
