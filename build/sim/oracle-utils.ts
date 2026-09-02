import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

// Core price data type used across the simulator (no slot or confidence per spec)
export interface PriceData {
  price: number;        // normalized price (e.g. 0.95 for depeg)
  timestamp: number;    // unix timestamp in seconds
}

// Historical prices for replay
export type HistoricalPrice = PriceData;

// Oracle abstraction used by lag injector and TWAP checker
export interface TestOracle {
  getPriceAt(ts: number): Promise<PriceData | null>;
  getHistoricalPrices(): Promise<HistoricalPrice[]>;
}

// Simple in-memory oracle for test validator replay
export class InMemoryOracle implements TestOracle {
  private prices: HistoricalPrice[];

  constructor(initialPrices: HistoricalPrice[]) {
    this.prices = [...initialPrices].sort((a, b) => a.timestamp - b.timestamp);
  }

  async getPriceAt(ts: number): Promise<PriceData | null> {
    if (this.prices.length === 0) return null;
    // find the most recent price before or at ts
    let closest: PriceData | null = null;
    for (const p of this.prices) {
      if (p.timestamp > ts) break;
      closest = p;
    }
    return closest;
  }

  async getHistoricalPrices(): Promise<HistoricalPrice[]> {
    return [...this.prices];
  }
}

// JitoSOL specific price series (last three depeg events - synthetic but realistic)
export const jitoDepegSeries: HistoricalPrice[] = [
  // First depeg series (approx 2024-03)
  { price: 0.998, timestamp: 1710000000 },
  { price: 0.975, timestamp: 1710003600 },
  { price: 0.942, timestamp: 1710007200 },
  { price: 0.918, timestamp: 1710010800 },
  { price: 0.935, timestamp: 1710014400 },
  { price: 0.962, timestamp: 1710018000 },
  { price: 0.981, timestamp: 1710021600 },
  // Second depeg series (approx 2024-04)
  { price: 0.999, timestamp: 1712000000 },
  { price: 0.967, timestamp: 1712003600 },
  { price: 0.931, timestamp: 1712007200 },
  { price: 0.904, timestamp: 1712010800 },
  { price: 0.922, timestamp: 1712014400 },
  { price: 0.955, timestamp: 1712018000 },
  { price: 0.988, timestamp: 1712021600 },
  // Third depeg series (approx 2024-05) - the one used for 45s lag tests
  { price: 1.000, timestamp: 1714000000 },
  { price: 0.982, timestamp: 1714003600 },
  { price: 0.951, timestamp: 1714007200 },
  { price: 0.912, timestamp: 1714010800 },
  { price: 0.889, timestamp: 1714014400 },
  { price: 0.905, timestamp: 1714018000 },
  { price: 0.937, timestamp: 1714021600 },
  { price: 0.972, timestamp: 1714025200 },
  { price: 0.991, timestamp: 1714028800 },
];

// Utility to create a lagged oracle (45s target lag, slot-exact simulation via timestamp offset)
export function createLaggedOracle(baseOracle: TestOracle, lagSeconds: number = 45): TestOracle {
  return {
    async getPriceAt(ts: number): Promise<PriceData | null> {
      const laggedTs = ts - lagSeconds;
      return baseOracle.getPriceAt(laggedTs);
    },
    async getHistoricalPrices(): Promise<HistoricalPrice[]> {
      return baseOracle.getHistoricalPrices();
    },
  };
}

// 15s TWAP calculator used by false-positive checker
export function calculateTWAP(prices: HistoricalPrice[], windowSeconds: number = 15): number | null {
  if (prices.length === 0) return null;
  const now = Math.max(...prices.map(p => p.timestamp));
  const cutoff = now - windowSeconds;
  const windowPrices = prices.filter(p => p.timestamp >= cutoff);
  if (windowPrices.length === 0) return null;
  const sum = windowPrices.reduce((acc, p) => acc + p.price, 0);
  return sum / windowPrices.length;
}

// Export TWAP config type for tick-runner compatibility
export interface TWAPConfig {
  windowSeconds: number;
  depegThreshold: number;   // e.g. 0.94
  falsePositiveTolerance: number;
}

// Default config used in sim
export const defaultTWAPConfig: TWAPConfig = {
  windowSeconds: 15,
  depegThreshold: 0.94,
  falsePositiveTolerance: 0.02,
};

// Check if TWAP would trigger a false positive on a given series
export function checkTWAPFalsePositive(
  prices: HistoricalPrice[],
  config: TWAPConfig = defaultTWAPConfig
): boolean {
  const twap = calculateTWAP(prices, config.windowSeconds);
  if (twap === null) return false;
  return twap < config.depegThreshold;
}

// Anchor program IDL fragment for vault (minimal, only what sim needs)
export const VaultIDL = {
  version: "0.1.0",
  name: "vault",
  instructions: [
    {
      name: "deposit",
      accounts: [
        { name: "vault", isMut: true, isSigner: false },
        { name: "user", isMut: true, isSigner: true },
        { name: "jitoMint", isMut: false, isSigner: false },
        { name: "userToken", isMut: true, isSigner: false },
        { name: "vaultToken", isMut: true, isSigner: false },
        { name: "tokenProgram", isMut: false, isSigner: false },
      ],
      args: [{ name: "amount", type: "u64" }],
    },
    {
      name: "drawdown",
      accounts: [
        { name: "vault", isMut: true, isSigner: false },
        { name: "owner", isMut: false, isSigner: true },
        { name: "protectionBuffer", isMut: true, isSigner: false },
      ],
      args: [],
    },
    {
      name: "pause",
      accounts: [
        { name: "vault", isMut: true, isSigner: false },
        { name: "owner", isMut: false, isSigner: true },
      ],
      args: [],
    },
    {
      name: "withdrawProtected",
      accounts: [
        { name: "vault", isMut: true, isSigner: false },
        { name: "owner", isMut: false, isSigner: true },
        { name: "protectionBuffer", isMut: true, isSigner: false },
        { name: "recipient", isMut: true, isSigner: false },
      ],
      args: [{ name: "amount", type: "u64" }],
    },
  ],
  accounts: [
    {
      name: "Vault",
      type: {
        kind: "struct",
        fields: [
          { name: "owner", type: "publicKey" },
          { name: "jitoMint", type: "publicKey" },
          { name: "totalDeposits", type: "u64" },
          { name: "isPaused", type: "bool" },
          { name: "drawdownThreshold", type: "u64" },
        ],
      },
    },
    {
      name: "ProtectionBuffer",
      type: {
        kind: "struct",
        fields: [
          { name: "balance", type: "u64" },
          { name: "lastDrawdown", type: "i64" },
        ],
      },
    },
  ],
} as const;
