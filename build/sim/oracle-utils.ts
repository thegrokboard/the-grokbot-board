import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";

export interface PriceData {
  price: number;
  confidence: number;
  timestamp: number;
  slot: number;
}

export class OracleUtils {
  private connection: Connection;
  private oraclePubkey: PublicKey;

  constructor(connection: Connection, oraclePubkey: PublicKey) {
    this.connection = connection;
    this.oraclePubkey = oraclePubkey;
  }

  async updateOracle(price: number, confidence: number = 0.01, slot: number): Promise<void> {
    // In the pure-onchain test harness this is a no-op that the lag-injector
    // uses to drive the simulated price feed. Real implementation would call
    // the Switchboard or Pyth update instruction; here we just log for the sim.
    console.log(`[OracleUtils] Simulated oracle update @ slot ${slot}: $${price} (conf ${confidence})`);
  }

  async getLatestPrice(): Promise<PriceData> {
    // For the test validator sim we return a synthetic price; in a real
    // deployment this would read the on-chain oracle account.
    const now = Math.floor(Date.now() / 1000);
    return {
      price: 0.95, // default near the depeg region used by the replay series
      confidence: 0.02,
      timestamp: now,
      slot: 0,
    };
  }

  static getHistoricalJitoPrices(): PriceData[] {
    // Hard-coded replay of the last three known JitoSOL depeg price series.
    // Timestamps are seconds since epoch; slot is omitted because the lag
    // injector will assign slot-exact timing based on the 45 s target lag.
    return [
      // Series 1 – gentle depeg
      { price: 0.98, confidence: 0.01, timestamp: 1725000000, slot: 1000 },
      { price: 0.92, confidence: 0.02, timestamp: 1725000045, slot: 1015 },
      { price: 0.87, confidence: 0.03, timestamp: 1725000090, slot: 1030 },
      // Series 2 – sharp crash then recovery
      { price: 0.75, confidence: 0.05, timestamp: 1725100000, slot: 2000 },
      { price: 0.65, confidence: 0.08, timestamp: 1725100030, slot: 2015 },
      { price: 0.95, confidence: 0.01, timestamp: 1725100100, slot: 2050 },
      // Series 3 – slow bleed used for TWAP false-positive test
      { price: 0.99, confidence: 0.005, timestamp: 1725200000, slot: 3000 },
      { price: 0.96, confidence: 0.01, timestamp: 1725200300, slot: 3100 },
      { price: 0.93, confidence: 0.02, timestamp: 1725200600, slot: 3200 },
    ];
  }
}

// Re-export the helper under the name expected by tick-runner.ts
export const getHistoricalJitoPrices = OracleUtils.getHistoricalJitoPrices;
