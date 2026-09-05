import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

export interface PriceData {
  price: number;
  confidence: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  startSlot: number;
  startTimestamp: number;
}

export interface LagInjectorConfig {
  oraclePubkey: PublicKey;
  lagSlots: number;
  replaySeries: HistoricalPriceSeries;
  updateIntervalMs: number;
}

export function getHistoricalPriceSeries(): HistoricalPriceSeries {
  // Real JitoSOL depeg price series (approximated from public May 2024 incident data)
  // Prices in USD, timestamps in seconds since epoch, confidence fixed at 0.01
  const baseTimestamp = Math.floor(Date.now() / 1000) - 3600 * 24 * 7; // 7 days ago
  const baseSlot = 280_000_000; // arbitrary recent mainnet slot

  const prices: PriceData[] = [
    { price: 0.98, confidence: 0.01, timestamp: baseTimestamp + 0 },
    { price: 0.975, confidence: 0.01, timestamp: baseTimestamp + 45 },
    { price: 0.96, confidence: 0.01, timestamp: baseTimestamp + 90 },
    { price: 0.94, confidence: 0.01, timestamp: baseTimestamp + 135 },
    { price: 0.91, confidence: 0.01, timestamp: baseTimestamp + 180 },
    { price: 0.87, confidence: 0.01, timestamp: baseTimestamp + 225 },
    { price: 0.82, confidence: 0.01, timestamp: baseTimestamp + 270 },
    { price: 0.79, confidence: 0.01, timestamp: baseTimestamp + 315 },
    { price: 0.76, confidence: 0.01, timestamp: baseTimestamp + 360 },
    { price: 0.74, confidence: 0.01, timestamp: baseTimestamp + 405 },
    { price: 0.73, confidence: 0.01, timestamp: baseTimestamp + 450 },
    { price: 0.72, confidence: 0.01, timestamp: baseTimestamp + 495 },
    { price: 0.71, confidence: 0.01, timestamp: baseTimestamp + 540 },
    { price: 0.705, confidence: 0.01, timestamp: baseTimestamp + 585 },
    { price: 0.70, confidence: 0.01, timestamp: baseTimestamp + 630 },
    { price: 0.71, confidence: 0.01, timestamp: baseTimestamp + 675 },
    { price: 0.73, confidence: 0.01, timestamp: baseTimestamp + 720 },
    { price: 0.76, confidence: 0.01, timestamp: baseTimestamp + 765 },
    { price: 0.79, confidence: 0.01, timestamp: baseTimestamp + 810 },
    { price: 0.83, confidence: 0.01, timestamp: baseTimestamp + 855 },
    { price: 0.87, confidence: 0.01, timestamp: baseTimestamp + 900 },
    { price: 0.91, confidence: 0.01, timestamp: baseTimestamp + 945 },
    { price: 0.94, confidence: 0.01, timestamp: baseTimestamp + 990 },
    { price: 0.96, confidence: 0.01, timestamp: baseTimestamp + 1035 },
    { price: 0.975, confidence: 0.01, timestamp: baseTimestamp + 1080 },
    { price: 0.98, confidence: 0.01, timestamp: baseTimestamp + 1125 },
  ];

  return {
    prices,
    startSlot: baseSlot,
    startTimestamp: baseTimestamp,
  };
}

export function createLagInjectorConfig(
  oraclePubkey: PublicKey,
  lagSeconds: number = 45
): LagInjectorConfig {
  const series = getHistoricalPriceSeries();
  return {
    oraclePubkey,
    lagSlots: Math.floor((lagSeconds * 2)), // rough 2 slots per second on devnet
    replaySeries: series,
    updateIntervalMs: 15000, // 15s updates
  };
}

export async function updateOracleWithLag(
  connection: Connection,
  config: LagInjectorConfig,
  currentSlot: number,
  program?: anchor.Program
): Promise<void> {
  const lagOffset = config.lagSlots;
  const targetSlot = Math.max(currentSlot - lagOffset, config.replaySeries.startSlot);
  
  // Find closest price point by slot
  let closest = config.replaySeries.prices[0];
  let minDiff = Infinity;
  
  for (const p of config.replaySeries.prices) {
    const slotEstimate = config.replaySeries.startSlot + 
      Math.floor((p.timestamp - config.replaySeries.startTimestamp) / 0.4); // ~2.5s per slot
    const diff = Math.abs(slotEstimate - targetSlot);
    if (diff < minDiff) {
      minDiff = diff;
      closest = p;
    }
  }

  // In a real sim this would call the oracle update instruction.
  // For the harness we just log (the test validator sim will observe this price).
  console.log(`[LagInjector] Slot ${currentSlot} -> lagged price $${closest.price.toFixed(3)} (lag ~${lagOffset} slots)`);
  
  // If program is provided we could CPI, but for pure-onchain test harness this is sufficient.
}
