import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction, SystemProgram } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  startSlot: number;
}

export interface LagInjectorConfig {
  lagMs: number;
  oraclePubkey: PublicKey;
  updateFrequencyMs: number;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  updateAuthority: PublicKey;
}

export class OracleUtils {
  static createUpdatePriceInstruction(
    oraclePubkey: PublicKey,
    updateAuthority: PublicKey,
    price: number,
    timestamp: number
  ): TransactionInstruction {
    // Dummy instruction for simulation (in real test validator this would call the oracle program)
    const data = Buffer.from([
      1, // update discriminator
      ...new anchor.BN(price * 1_000_000).toArray("le", 8),
      ...new anchor.BN(timestamp).toArray("le", 8),
    ]);

    return new TransactionInstruction({
      keys: [
        { pubkey: oraclePubkey, isSigner: false, isWritable: true },
        { pubkey: updateAuthority, isSigner: true, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: new PublicKey("11111111111111111111111111111111"), // placeholder
      data,
    });
  }

  static getHistoricalPriceSeries(): HistoricalPriceSeries {
    // Last three JitoSOL depeg series (simulated realistic data around 0.9x)
    return {
      prices: [
        { price: 0.98, timestamp: 1725000000 },
        { price: 0.97, timestamp: 1725000030 },
        { price: 0.95, timestamp: 1725000060 },
        { price: 0.92, timestamp: 1725000090 },
        { price: 0.89, timestamp: 1725000120 },
        { price: 0.87, timestamp: 1725000150 },
        { price: 0.85, timestamp: 1725000180 },
        { price: 0.84, timestamp: 1725000210 },
        { price: 0.88, timestamp: 1725000240 },
        { price: 0.91, timestamp: 1725000270 },
        { price: 0.93, timestamp: 1725000300 },
      ],
      startSlot: 123456789,
    };
  }

  static calculateTWAP(prices: PriceData[], windowMs: number = 15000): number {
    if (prices.length === 0) return 0;
    const now = prices[prices.length - 1].timestamp * 1000;
    const cutoff = now - windowMs;
    const relevant = prices.filter(p => p.timestamp * 1000 >= cutoff);
    if (relevant.length === 0) return prices[prices.length - 1].price;

    let sum = 0;
    let lastT = relevant[0].timestamp * 1000;
    for (let i = 1; i < relevant.length; i++) {
      const t = relevant[i].timestamp * 1000;
      const dt = t - lastT;
      sum += relevant[i - 1].price * dt;
      lastT = t;
    }
    const totalDuration = lastT - cutoff;
    return totalDuration > 0 ? sum / totalDuration : relevant[relevant.length - 1].price;
  }

  static checkTWAPFalsePositive(
    series: HistoricalPriceSeries,
    lagMs: number = 45000
  ): boolean {
    const twap15s = OracleUtils.calculateTWAP(series.prices, 15000);
    const laggedPrices = series.prices.map(p => ({
      price: p.price,
      timestamp: p.timestamp + Math.floor(lagMs / 1000),
    }));
    const twap15sLagged = OracleUtils.calculateTWAP(laggedPrices, 15000);
    // False positive if TWAP didn't cross breaker threshold but lagged view would have
    return twap15s > 0.9 && twap15sLagged < 0.85;
  }
}

export { OracleUtils };
export type { PriceData, HistoricalPriceSeries, LagInjectorConfig, OracleConfig };
