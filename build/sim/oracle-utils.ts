import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import { Vault } from "../target/types/vault";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
}

export interface LagInjectorConfig {
  lagMs: number;
  oracleProgramId: PublicKey;
  oracleAccount: PublicKey;
}

export interface OracleConfig {
  lagSlots: number;
  updateInterval: number;
}

export class OracleUtils {
  static async getHistoricalPriceSeries(
    connection: Connection,
    oracleAccount: PublicKey,
    limit: number = 1000
  ): Promise<HistoricalPriceSeries> {
    // For the sim we replay synthetic Jito depeg series; in a real deployment this would read from on-chain history
    const series: PriceData[] = [];
    const baseTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const depegStart = baseTime + 3 * 24 * 60 * 60 * 1000;

    for (let i = 0; i < limit; i++) {
      const t = baseTime + i * 15_000;
      let price = 1.0;
      if (t >= depegStart) {
        const minutesSince = (t - depegStart) / 60000;
        price = Math.max(0.65, 1.0 - 0.012 * minutesSince);
      }
      series.push({ price, timestamp: t });
    }
    return { prices: series };
  }

  static createUpdatePriceInstruction(
    oracleProgramId: PublicKey,
    oracleAccount: PublicKey,
    price: number,
    timestamp: number,
    signer: PublicKey
  ): TransactionInstruction {
    const data = Buffer.alloc(16);
    data.writeDoubleLE(price, 0);
    data.writeBigUInt64LE(BigInt(Math.floor(timestamp / 1000)), 8);

    return new TransactionInstruction({
      keys: [
        { pubkey: oracleAccount, isSigner: false, isWritable: true },
        { pubkey: signer, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: oracleProgramId,
      data,
    });
  }

  static async updateOracleWithLag(
    provider: anchor.Provider,
    config: LagInjectorConfig,
    price: number,
    timestamp: number
  ): Promise<void> {
    const ix = OracleUtils.createUpdatePriceInstruction(
      config.oracleProgramId,
      config.oracleAccount,
      price,
      timestamp - config.lagMs,
      (provider as any).wallet.publicKey
    );
    const tx = new anchor.web3.Transaction().add(ix);
    await (provider as any).sendAndConfirm(tx);
  }

  static calculateTWAP(prices: PriceData[], windowMs: number = 15_000): number {
    if (prices.length === 0) return 0;
    let sum = 0;
    let count = 0;
    const now = prices[prices.length - 1].timestamp;
    for (let i = prices.length - 1; i >= 0; i--) {
      if (now - prices[i].timestamp > windowMs) break;
      sum += prices[i].price;
      count++;
    }
    return count > 0 ? sum / count : prices[prices.length - 1].price;
  }

  static checkTWAPFalsePositive(series: HistoricalPriceSeries, currentPrice: number, threshold: number = 0.85): boolean {
    const twap = OracleUtils.calculateTWAP(series.prices);
    return twap > threshold && currentPrice < threshold;
  }
}

// Re-export for convenience
export { OracleUtils };
export type { PriceData, HistoricalPriceSeries, LagInjectorConfig, OracleConfig };
