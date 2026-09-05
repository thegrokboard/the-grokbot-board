import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  startSlot: number;
  endSlot: number;
}

export interface LagInjectorConfig {
  oraclePubkey: PublicKey;
  lagSlots: number;
  basePrice: number;
  series: HistoricalPriceSeries;
}

export class OracleUtils {
  private connection: Connection;
  private program: any; // Anchor program

  constructor(connection: Connection, program: any) {
    this.connection = connection;
    this.program = program;
  }

  static createHistoricalSeries(prices: number[], startSlot: number = 0): HistoricalPriceSeries {
    const priceData: PriceData[] = prices.map((price, index) => ({
      price,
      timestamp: Date.now() + index * 15000, // 15s intervals
    }));
    return {
      prices: priceData,
      startSlot,
      endSlot: startSlot + prices.length * 15, // rough slot estimate
    };
  }

  async injectSeries(config: LagInjectorConfig, wallet: Keypair): Promise<void> {
    // In sim, we update the on-chain oracle account with lagged values
    for (let i = 0; i < config.series.prices.length; i++) {
      const laggedIndex = Math.max(0, i - Math.floor(config.lagSlots / 15));
      const price = config.series.prices[laggedIndex].price;
      
      await this.updateOraclePrice(config.oraclePubkey, price, wallet);
      // Advance simulated time (in real test validator this would use setBlockTime)
      await new Promise(resolve => setTimeout(resolve, 50)); // simulate slot time
    }
  }

  async updateOraclePrice(oraclePubkey: PublicKey, price: number, wallet: Keypair): Promise<void> {
    // Simulate oracle update via program instruction (vault program owns or proxies oracle)
    await this.program.methods
      .updateOracle(new anchor.BN(Math.floor(price * 1_000_000))) // 6 decimals
      .accounts({
        oracle: oraclePubkey,
        authority: wallet.publicKey,
      })
      .signers([wallet])
      .rpc();
  }

  static checkTWAPFalsePositive(series: HistoricalPriceSeries, twapPeriodSlots: number = 15 * 60): boolean {
    if (series.prices.length < 2) return false;
    
    // Simple TWAP calculation over last N points
    const period = Math.min(twapPeriodSlots / 15, series.prices.length);
    const recentPrices = series.prices.slice(-period);
    const twap = recentPrices.reduce((sum, p) => sum + p.price, 0) / recentPrices.length;
    const lastPrice = recentPrices[recentPrices.length - 1].price;
    
    // False positive if TWAP > 5% from spot while in recovery (simplified)
    const deviation = Math.abs(lastPrice - twap) / twap;
    return deviation > 0.05 && lastPrice > twap * 0.9; // example false-positive condition
  }

  getLagAdjustedPrice(series: HistoricalPriceSeries, lagSlots: number, currentIndex: number): number {
    const lagSteps = Math.floor(lagSlots / 15); // assuming 15s slots for sim
    const laggedIndex = Math.max(0, currentIndex - lagSteps);
    return series.prices[laggedIndex].price;
  }
}

// Default config factory for Jito depeg replay
export function createJitoDepegSeries(): HistoricalPriceSeries {
  // Replay of last three known JitoSOL depeg price drops (simulated values)
  const depegPrices = [
    0.98, 0.97, 0.95, 0.92, 0.89, 0.85, 0.82, 0.80, 0.78, // first depeg
    0.79, 0.81, 0.84, 0.88, 0.91, 0.93,                     // partial recovery
    0.90, 0.87, 0.83, 0.79, 0.75, 0.71, 0.68, 0.65, 0.62, // second depeg
    0.64, 0.67, 0.72, 0.78, 0.85, 0.89,                     // recovery
    0.88, 0.86, 0.82, 0.77, 0.73, 0.70, 0.68, 0.67, 0.66, // third depeg
    0.67, 0.69, 0.72, 0.76, 0.81, 0.87, 0.92
  ];
  return {
    prices: depegPrices.map((p, i) => ({
      price: p,
      timestamp: Date.now() - (depegPrices.length - i) * 15000,
    })),
    startSlot: 100000,
    endSlot: 100000 + depegPrices.length * 15,
  };
}

export default OracleUtils;
