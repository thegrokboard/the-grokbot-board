import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number; // unix seconds
  slot: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  startSlot: number;
  endSlot: number;
}

export interface OracleUtilsConfig {
  rpcUrl?: string;
  jitoSolMint?: PublicKey;
}

export class OracleUtils {
  private connection: Connection;
  private jitoSolMint: PublicKey;

  constructor(config: OracleUtilsConfig = {}) {
    this.connection = new Connection(
      config.rpcUrl || "http://127.0.0.1:8899",
      "confirmed"
    );
    this.jitoSolMint = config.jitoSolMint || new PublicKey("J1toso1uCk3RLmjorhT7G6oqS2xJ2b4f2b4f2b4f2b");
  }

  async getLatestPrice(): Promise<PriceData> {
    // Simulated latest on-chain price for test validator
    const slot = await this.connection.getSlot();
    return {
      price: 0.95,
      timestamp: Math.floor(Date.now() / 1000),
      slot,
    };
  }

  async updatePriceFeed(price: number, slot?: number): Promise<void> {
    // In the pure-onchain sim this updates a local mock oracle account.
    // For the replay harness we simply log (real implementation would CPI or write to test oracle).
    console.log(`[OracleUtils] updatePriceFeed price=${price} slot=${slot}`);
  }
}

// Default historical JitoSOL depeg replay series (last three known depegs approximated)
// Prices are normalized around 1.0; these are crafted to trigger realistic TWAP checks.
export function getHistoricalJitoPrices(): HistoricalPriceSeries {
  const now = Math.floor(Date.now() / 1000);
  const baseSlot = 1_000_000;

  const prices: PriceData[] = [
    // First depeg (mild)
    { price: 0.98, timestamp: now - 3600, slot: baseSlot + 100 },
    { price: 0.92, timestamp: now - 3500, slot: baseSlot + 200 },
    { price: 0.89, timestamp: now - 3400, slot: baseSlot + 300 },
    { price: 0.85, timestamp: now - 3300, slot: baseSlot + 400 },
    // Second depeg (sharp)
    { price: 0.78, timestamp: now - 1800, slot: baseSlot + 800 },
    { price: 0.65, timestamp: now - 1700, slot: baseSlot + 900 },
    { price: 0.62, timestamp: now - 1600, slot: baseSlot + 1000 },
    // Third depeg (recovery + re-depeg)
    { price: 0.75, timestamp: now - 600, slot: baseSlot + 1400 },
    { price: 0.88, timestamp: now - 500, slot: baseSlot + 1500 },
    { price: 0.94, timestamp: now - 400, slot: baseSlot + 1600 },
    { price: 0.82, timestamp: now - 300, slot: baseSlot + 1700 },
  ];

  return {
    prices,
    startSlot: baseSlot,
    endSlot: baseSlot + 2000,
  };
}

export default getHistoricalJitoPrices;
