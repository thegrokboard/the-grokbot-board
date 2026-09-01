import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { createPriceAccount, PriceData, updatePriceAccount } from "./oracle-utils";

export interface TwapChecker {
  update(price: number, slot: number, timestamp: number): void;
  isFalsePositive(currentPrice: number, currentSlot: number): boolean;
  reset(): void;
}

export function createTwapChecker(windowSlots: number = 75): TwapChecker { // ~15s at 5Hz
  let prices: { price: number; slot: number; timestamp: number; confidence: number }[] = [];

  function update(price: number, slot: number, timestamp: number): void {
    const confidence = 0.01; // fixed low confidence for sim
    prices.push({ price, slot, timestamp, confidence });
    // keep only last window + buffer
    if (prices.length > windowSlots * 2) {
      prices = prices.slice(-windowSlots * 2);
    }
  }

  function isFalsePositive(currentPrice: number, currentSlot: number): boolean {
    if (prices.length < 3) return false;

    // find prices within the 15s (75 slot) window
    const windowStart = currentSlot - windowSlots;
    const windowPrices = prices
      .filter(p => p.slot >= windowStart && p.slot <= currentSlot)
      .sort((a, b) => a.slot - b.slot);

    if (windowPrices.length < 3) return false;

    // simple TWAP
    let weightedSum = 0;
    let totalWeight = 0;
    for (let i = 0; i < windowPrices.length; i++) {
      const p = windowPrices[i];
      const nextSlot = i < windowPrices.length - 1 ? windowPrices[i + 1].slot : currentSlot;
      const weight = nextSlot - p.slot;
      weightedSum += p.price * weight;
      totalWeight += weight;
    }

    const twap = totalWeight > 0 ? weightedSum / totalWeight : windowPrices[0].price;
    const deviation = Math.abs(currentPrice - twap) / twap;

    // false-positive if deviation is small but would trigger breaker in sim
    return deviation < 0.08; // 8% threshold tuned for Jito depeg replay
  }

  function reset(): void {
    prices = [];
  }

  return { update, isFalsePositive, reset };
}

// Legacy export to satisfy existing import in tick-runner.ts
export const checkTWAPFalsePositive = (prices: PriceData[], currentPrice: number, currentSlot: number): boolean => {
  const checker = createTwapChecker(75);
  prices.forEach(p => {
    checker.update(p.price, p.slot, p.timestamp || Math.floor(Date.now() / 1000));
  });
  return checker.isFalsePositive(currentPrice, currentSlot);
};

// Helper to convert oracle PriceData
export function priceDataFromOracle(account: any): PriceData {
  return {
    price: account.price.toNumber ? account.price.toNumber() / 1e9 : account.price,
    confidence: account.confidence ? (account.confidence.toNumber ? account.confidence.toNumber() / 1e9 : account.confidence) : 0.01,
    slot: account.slot ? (account.slot.toNumber ? account.slot.toNumber() : account.slot) : 0,
    timestamp: account.timestamp || Math.floor(Date.now() / 1000),
  };
}
