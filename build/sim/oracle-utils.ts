import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, TransactionInstruction, Keypair } from "@solana/web3.js";
import { BN } from "bn.js";

export interface PriceData {
  price: BN;
  timestamp: BN;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  oracle: PublicKey;
}

export interface LagInjectorConfig {
  lagSlots: number;
  targetLagMs: number;
  series: HistoricalPriceSeries[];
}

export interface OracleConfig {
  oracle: PublicKey;
  owner: PublicKey;
  lagSlots: number;
}

export class OracleUtils {
  static createPriceData(price: number, timestamp: number): PriceData {
    return {
      price: new BN(Math.floor(price * 1_000_000)), // 6 decimals
      timestamp: new BN(timestamp),
    };
  }

  static createHistoricalPriceSeries(oracle: PublicKey, prices: PriceData[]): HistoricalPriceSeries {
    return {
      prices,
      oracle,
    };
  }

  static getHistoricalPriceSeries(config: LagInjectorConfig, oracle: PublicKey): HistoricalPriceSeries | undefined {
    return config.series.find(s => s.oracle.equals(oracle));
  }

  static createLagInjectorConfig(
    lagSlots: number,
    targetLagMs: number,
    series: HistoricalPriceSeries[]
  ): LagInjectorConfig {
    return {
      lagSlots,
      targetLagMs,
      series,
    };
  }

  static createUpdatePriceInstruction(
    oracle: PublicKey,
    priceData: PriceData,
    signer: PublicKey
  ): TransactionInstruction {
    // Placeholder for Switchboard-like update; in real sim this would be a real CPI or custom ix
    const data = Buffer.from([
      1, // discriminator
      ...priceData.price.toArray("le", 8),
      ...priceData.timestamp.toArray("le", 8),
    ]);
    return new TransactionInstruction({
      keys: [
        { pubkey: oracle, isSigner: false, isWritable: true },
        { pubkey: signer, isSigner: true, isWritable: false },
      ],
      programId: new PublicKey("SW1TCH7K2a3w4zXJ8v9pQ2mN7bL5kR6tY4uI9oP0qRs"), // dummy oracle program
      data,
    });
  }

  static async replaySeriesWithLag(
    connection: Connection,
    config: LagInjectorConfig,
    currentSlot: number
  ): Promise<void> {
    for (const series of config.series) {
      const lagIndex = Math.max(0, series.prices.length - config.lagSlots - 1);
      if (lagIndex < series.prices.length) {
        const laggedPrice = series.prices[lagIndex];
        const ix = this.createUpdatePriceInstruction(series.oracle, laggedPrice, PublicKey.default);
        // In full sim this would be sent; here we just log for test harness
        console.log(`Injected lagged price ${laggedPrice.price.toString()} at slot ${currentSlot}`);
      }
    }
  }

  static checkTWAPFalsePositive(
    prices: PriceData[],
    windowSeconds: number,
    thresholdBps: number
  ): boolean {
    if (prices.length < 2) return false;
    const now = prices[prices.length - 1].timestamp.toNumber();
    const windowStart = now - windowSeconds;
    const windowPrices = prices.filter(p => p.timestamp.toNumber() >= windowStart);
    if (windowPrices.length < 2) return false;

    const startPrice = windowPrices[0].price.toNumber();
    const endPrice = windowPrices[windowPrices.length - 1].price.toNumber();
    const changeBps = Math.abs((endPrice - startPrice) * 10000 / startPrice);
    return changeBps < thresholdBps;
  }
}

export { OracleUtils };
export type { PriceData, HistoricalPriceSeries, LagInjectorConfig, OracleConfig };
