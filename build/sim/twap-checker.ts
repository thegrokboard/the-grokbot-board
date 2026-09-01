import { PriceData } from './oracle-utils';

export interface TWAPConfig {
  windowSlots: number;
  thresholdBps: number;
  minObservations: number;
}

export const DEFAULT_TWAP_CONFIG: TWAPConfig = {
  windowSlots: 150, // ~1 minute at 400ms/slot
  thresholdBps: 500, // 5% depeg
  minObservations: 8,
};

export function isFalsePositive(
  prices: PriceData[],
  config: TWAPConfig = DEFAULT_TWAP_CONFIG
): boolean {
  if (prices.length < config.minObservations) {
    return false;
  }

  // Sort by timestamp to ensure chronological order
  const sorted = [...prices].sort((a, b) => a.timestamp - b.timestamp);
  
  // Use the most recent windowSlots worth of data
  const recent = sorted.slice(-config.windowSlots);
  if (recent.length < config.minObservations) {
    return false;
  }

  // Simple TWAP calculation using price and confidence-weighted average
  let weightedSum = 0;
  let totalWeight = 0;
  const latestPrice = recent[recent.length - 1].price;

  for (const p of recent) {
    // Confidence as weight (higher confidence = higher weight)
    const weight = p.confidence > 0 ? 1 / p.confidence : 1.0;
    weightedSum += p.price * weight;
    totalWeight += weight;
  }

  const twap = totalWeight > 0 ? weightedSum / totalWeight : latestPrice;
  
  // Calculate deviation in basis points
  const deviation = Math.abs(latestPrice - twap) / twap * 10000;
  
  // If deviation is within threshold, it's likely a false positive (TWAP hasn't caught up)
  return deviation < config.thresholdBps;
}

export const checkTWAPFalsePositive = isFalsePositive;

// For compatibility with lag-injector replay series
export function checkTWAP(
  prices: PriceData[],
  config?: TWAPConfig
): boolean {
  return isFalsePositive(prices, config);
}
