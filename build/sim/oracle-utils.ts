import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

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

export interface LagInjectorConfig {
  lagSlots: number;
  replaySeries: HistoricalPriceSeries;
  oraclePubkey: PublicKey;
}

export interface OracleLagInjector {
  injectPriceAtSlot(slot: number, priceData: PriceData): Promise<void>;
  getCurrentPrice(): Promise<PriceData>;
}

export function getHistoricalPriceSeries(): HistoricalPriceSeries {
  // Last three Jito depeg price series (simulated - 45s lag target)
  // Prices in lamports per SOL (approx 0.95 -> 0.85 depeg region)
  const prices: PriceData[] = [
    { price: 0.98, confidence: 0.02, timestamp: 1720000000, slot: 1000 },
    { price: 0.97, confidence: 0.02, timestamp: 1720000015, slot: 1015 },
    { price: 0.96, confidence: 0.03, timestamp: 1720000030, slot: 1030 },
    { price: 0.94, confidence: 0.04, timestamp: 1720000045, slot: 1045 },
    { price: 0.91, confidence: 0.05, timestamp: 1720000060, slot: 1060 },
    { price: 0.88, confidence: 0.06, timestamp: 1720000075, slot: 1075 },
    { price: 0.87, confidence: 0.07, timestamp: 1720000090, slot: 1090 },
    { price: 0.85, confidence: 0.08, timestamp: 1720000105, slot: 1105 },
    { price: 0.86, confidence: 0.07, timestamp: 1720000120, slot: 1120 },
    { price: 0.89, confidence: 0.05, timestamp: 1720000135, slot: 1135 },
    { price: 0.92, confidence: 0.04, timestamp: 1720000150, slot: 1150 },
    { price: 0.94, confidence: 0.03, timestamp: 1720000165, slot: 1165 },
  ];

  return {
    prices,
    startSlot: 1000,
    endSlot: 1165,
  };
}

export function createLagInjectorConfig(oraclePubkey: PublicKey): LagInjectorConfig {
  return {
    lagSlots: 45, // target 45s lag at ~0.4s/slot
    replaySeries: getHistoricalPriceSeries(),
    oraclePubkey,
  };
}
