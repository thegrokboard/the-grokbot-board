import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export interface OracleConfig {
  oraclePubkey: PublicKey;
  priceFeedId: string; // for Pyth-like oracles
}

export interface LagInjectorConfig {
  lagMs: number; // target 45s
  slotMs: number; // ms per slot, default 400
  startSlot: number;
  oracle: OracleConfig;
}

export interface PriceData {
  price: number;
  confidence: number;
  timestamp: number;
  slot: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  startSlot: number;
  endSlot: number;
}

export function getHistoricalPriceSeries(): HistoricalPriceSeries {
  // Replay of last three JitoSOL depeg events (synthetic but realistic)
  // Prices in USD, timestamps in seconds since epoch, slots derived from start
  const startSlot = 123456789;
  const slotDurationMs = 400;
  const baseTimestamp = Math.floor(Date.now() / 1000) - 3600 * 24 * 7; // 7 days ago

  const prices: PriceData[] = [
    // Event 1: mild depeg
    { price: 0.98, confidence: 0.02, timestamp: baseTimestamp + 100, slot: startSlot + 250 },
    { price: 0.95, confidence: 0.03, timestamp: baseTimestamp + 200, slot: startSlot + 500 },
    { price: 0.92, confidence: 0.04, timestamp: baseTimestamp + 350, slot: startSlot + 875 },
    { price: 0.90, confidence: 0.05, timestamp: baseTimestamp + 500, slot: startSlot + 1250 },
    { price: 0.96, confidence: 0.02, timestamp: baseTimestamp + 800, slot: startSlot + 2000 },

    // Event 2: sharp depeg (the classic JitoSOL event)
    { price: 0.97, confidence: 0.01, timestamp: baseTimestamp + 3700, slot: startSlot + 9250 },
    { price: 0.85, confidence: 0.08, timestamp: baseTimestamp + 3850, slot: startSlot + 9625 },
    { price: 0.78, confidence: 0.12, timestamp: baseTimestamp + 4000, slot: startSlot + 10000 },
    { price: 0.72, confidence: 0.15, timestamp: baseTimestamp + 4200, slot: startSlot + 10500 },
    { price: 0.81, confidence: 0.09, timestamp: baseTimestamp + 4600, slot: startSlot + 11500 },
    { price: 0.94, confidence: 0.03, timestamp: baseTimestamp + 5200, slot: startSlot + 13000 },

    // Event 3: recent minor depeg
    { price: 0.99, confidence: 0.01, timestamp: baseTimestamp + 18000, slot: startSlot + 45000 },
    { price: 0.94, confidence: 0.04, timestamp: baseTimestamp + 18150, slot: startSlot + 45375 },
    { price: 0.89, confidence: 0.06, timestamp: baseTimestamp + 18300, slot: startSlot + 45750 },
    { price: 0.93, confidence: 0.04, timestamp: baseTimestamp + 18600, slot: startSlot + 46500 },
    { price: 0.98, confidence: 0.02, timestamp: baseTimestamp + 19000, slot: startSlot + 47500 },
  ];

  return {
    prices,
    startSlot,
    endSlot: startSlot + 50000,
  };
}

export function getPriceAtSlot(series: HistoricalPriceSeries, slot: number): PriceData {
  // Find latest price before or at the given slot (step function)
  let latest = series.prices[0];
  for (const p of series.prices) {
    if (p.slot <= slot) {
      latest = p;
    } else {
      break;
    }
  }
  return { ...latest };
}

export function injectLag(config: LagInjectorConfig, series: HistoricalPriceSeries, currentSlot: number): PriceData {
  const laggedSlot = Math.max(series.startSlot, currentSlot - Math.floor(config.lagMs / config.slotMs));
  const price = getPriceAtSlot(series, laggedSlot);
  return {
    price: price.price,
    confidence: price.confidence,
    timestamp: price.timestamp,
    slot: currentSlot,
  };
}

export function createTestOracleAccount(
  provider: anchor.Provider,
  initialPrice: number
): Promise<PublicKey> {
  // In real sim we would create a mock Pyth/Switchboard account.
  // For this harness we return a dummy pubkey; the TS sim only reads from series.
  return Promise.resolve(new PublicKey("11111111111111111111111111111111"));
}
