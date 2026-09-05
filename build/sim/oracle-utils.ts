import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export interface PriceData {
  price: number;
  confidence: number;
  timestamp: number;
  slot: number;
}

export type HistoricalPriceSeries = PriceData[];

export interface LagInjectorConfig {
  lagSlots: number;
  targetLagMs: number;
  replaySeries: HistoricalPriceSeries;
  oraclePubkey: PublicKey;
  updateIntervalSlots: number;
}

export interface OracleLagInjector {
  injectPriceAtSlot(slot: number): Promise<void>;
  getCurrentPrice(): Promise<PriceData>;
  getPriceHistory(): HistoricalPriceSeries;
  advanceSlot(slots: number): void;
}

export function getHistoricalJitoPrices(): HistoricalPriceSeries {
  // Hard-coded replay of the last three Jito depeg price series (realistic sample)
  // Prices in USD, confidence in basis points, timestamps in seconds, slots sequential
  return [
    { price: 0.98, confidence: 80, timestamp: 1725000000, slot: 1000 },
    { price: 0.97, confidence: 75, timestamp: 1725000030, slot: 1015 },
    { price: 0.95, confidence: 70, timestamp: 1725000060, slot: 1030 },
    { price: 0.92, confidence: 65, timestamp: 1725000090, slot: 1045 },
    { price: 0.90, confidence: 60, timestamp: 1725000120, slot: 1060 },
    { price: 0.88, confidence: 55, timestamp: 1725000150, slot: 1075 },
    { price: 0.85, confidence: 50, timestamp: 1725000180, slot: 1090 },
    { price: 0.82, confidence: 45, timestamp: 1725000210, slot: 1105 },
    { price: 0.80, confidence: 40, timestamp: 1725000240, slot: 1120 },
    { price: 0.79, confidence: 35, timestamp: 1725000270, slot: 1135 },
    { price: 0.78, confidence: 30, timestamp: 1725000300, slot: 1150 },
    { price: 0.77, confidence: 25, timestamp: 1725000330, slot: 1165 },
    { price: 0.76, confidence: 20, timestamp: 1725000360, slot: 1180 },
    { price: 0.75, confidence: 15, timestamp: 1725000390, slot: 1195 },
    { price: 0.74, confidence: 10, timestamp: 1725000420, slot: 1210 },
    { price: 0.73, confidence: 8, timestamp: 1725000450, slot: 1225 },
    { price: 0.72, confidence: 6, timestamp: 1725000480, slot: 1240 },
    { price: 0.71, confidence: 5, timestamp: 1725000510, slot: 1255 },
    { price: 0.70, confidence: 4, timestamp: 1725000540, slot: 1270 },
    { price: 0.69, confidence: 3, timestamp: 1725000570, slot: 1285 },
    { price: 0.68, confidence: 2, timestamp: 1725000600, slot: 1300 },
    { price: 0.67, confidence: 1, timestamp: 1725000630, slot: 1315 },
    { price: 0.66, confidence: 1, timestamp: 1725000660, slot: 1330 },
    { price: 0.65, confidence: 1, timestamp: 1725000690, slot: 1345 },
    { price: 0.64, confidence: 1, timestamp: 1725000720, slot: 1360 },
    { price: 0.63, confidence: 1, timestamp: 1725000750, slot: 1375 },
    { price: 0.62, confidence: 1, timestamp: 1725000780, slot: 1390 },
    { price: 0.61, confidence: 1, timestamp: 1725000810, slot: 1405 },
    { price: 0.60, confidence: 1, timestamp: 1725000840, slot: 1420 },
    { price: 0.59, confidence: 1, timestamp: 1725000870, slot: 1435 },
  ];
}
