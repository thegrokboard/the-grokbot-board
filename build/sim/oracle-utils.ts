import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
}

export interface TWAPConfig {
  windowSeconds: number;
  thresholdBps: number;
  minObservations: number;
}

export function getHistoricalJitoPrices(): HistoricalPriceSeries {
  // Last three known JitoSOL depeg episodes (simulated realistic series)
  // Prices in USD, timestamps in seconds (relative, will be shifted by injector)
  return {
    prices: [
      // Minor depeg 1
      { price: 0.98, timestamp: 0 },
      { price: 0.975, timestamp: 30 },
      { price: 0.96, timestamp: 65 },
      { price: 0.955, timestamp: 110 },
      { price: 0.97, timestamp: 160 },
      // Minor depeg 2
      { price: 0.99, timestamp: 200 },
      { price: 0.945, timestamp: 240 },
      { price: 0.92, timestamp: 280 },
      { price: 0.935, timestamp: 320 },
      { price: 0.96, timestamp: 370 },
      // Major depeg (the one that should trip breaker)
      { price: 1.0, timestamp: 400 },
      { price: 0.89, timestamp: 450 },
      { price: 0.82, timestamp: 490 },
      { price: 0.78, timestamp: 530 },
      { price: 0.81, timestamp: 580 },
      { price: 0.85, timestamp: 630 },
      { price: 0.91, timestamp: 680 },
    ],
  };
}

export function calculateTWAP(prices: PriceData[], windowSeconds: number): number {
  if (prices.length === 0) return 0;
  
  const now = Math.max(...prices.map(p => p.timestamp));
  const cutoff = now - windowSeconds;
  
  const windowPrices = prices
    .filter(p => p.timestamp >= cutoff)
    .sort((a, b) => a.timestamp - b.timestamp);
  
  if (windowPrices.length === 0) return prices[prices.length - 1].price;
  
  // Simple time-weighted average (equal weight per observation for sim)
  let sum = 0;
  for (const p of windowPrices) {
    sum += p.price;
  }
  return sum / windowPrices.length;
}

export function checkTWAPFalsePositive(
  series: HistoricalPriceSeries,
  config: TWAPConfig,
  currentPrice: number,
  currentTime: number
): boolean {
  const allPrices = [...series.prices];
  allPrices.push({ price: currentPrice, timestamp: currentTime });
  
  const twap = calculateTWAP(allPrices, config.windowSeconds);
  const deviationBps = Math.abs(currentPrice - twap) * 10000;
  
  return deviationBps > config.thresholdBps;
}

// Alias for backward compatibility with tick-runner
export const checkTWAPFalsePositive as any = checkTWAPFalsePositive;
