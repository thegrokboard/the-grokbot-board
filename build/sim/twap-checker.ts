import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { createPriceAccount, PriceData, updatePriceAccount } from "./oracle-utils";

export interface TwapState {
  lastUpdateSlot: number;
  prices: { slot: number; price: number }[];
  twap: number;
  periodSlots: number;
}

export function createTwapChecker(
  periodSeconds: number = 15,
  slotDurationMs: number = 400
): TwapState {
  const periodSlots = Math.ceil((periodSeconds * 1000) / slotDurationMs);
  return {
    lastUpdateSlot: 0,
    prices: [],
    twap: 0,
    periodSlots,
  };
}

export function updateTwap(
  state: TwapState,
  currentSlot: number,
  price: number
): void {
  // Add new price
  state.prices.push({ slot: currentSlot, price });

  // Remove prices older than the window
  const cutoffSlot = currentSlot - state.periodSlots;
  while (state.prices.length > 0 && state.prices[0].slot < cutoffSlot) {
    state.prices.shift();
  }

  if (state.prices.length === 0) {
    state.twap = price;
    state.lastUpdateSlot = currentSlot;
    return;
  }

  // Simple time-weighted average (equal weight per observation for sim)
  let sum = 0;
  for (const p of state.prices) {
    sum += p.price;
  }
  state.twap = sum / state.prices.length;
  state.lastUpdateSlot = currentSlot;
}

export function isFalsePositive(
  state: TwapState,
  currentPrice: number,
  depegThreshold: number = 0.05 // 5% deviation from TWAP
): boolean {
  if (state.prices.length < 2) return false;
  const deviation = Math.abs(currentPrice - state.twap) / state.twap;
  return deviation < depegThreshold;
}

// High-level helper used by tick-runner
export async function createAndUpdateTwapChecker(
  connection: anchor.web3.Connection,
  priceAccount: PublicKey,
  state: TwapState,
  currentSlot: number
): Promise<boolean> {
  const accountInfo = await connection.getAccountInfo(priceAccount);
  if (!accountInfo) throw new Error("Price account not found");

  const priceData: PriceData = {
    price: new anchor.BN(0),
    slot: new anchor.BN(0),
  };

  // Minimal parse for sim (real Pyth/Oracle would use proper layout; here we use dummy)
  // For this harness we assume priceAccount stores raw u64 price in first 8 bytes
  const price = Number(accountInfo.data.readBigUInt64LE(0)) / 1e9; // normalize to SOL-like scale

  updateTwap(state, currentSlot, price);
  return isFalsePositive(state, price);
}
