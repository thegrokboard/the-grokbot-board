import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, TransactionInstruction, Keypair } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  symbol: string;
  oracle: PublicKey;
  prices: PriceData[];
}

export interface LagInjectorConfig {
  lagMs: number;
  slotLag?: number;
  filter?: (p: PriceData) => boolean;
}

export interface OracleConfig {
  oracle: PublicKey;
  symbol: string;
  lagSlots: number;
}

export class OracleUtils {
  static createUpdatePriceInstruction(
    oracle: PublicKey,
    price: number,
    timestamp: number,
    payer: PublicKey
  ): TransactionInstruction {
    // Minimal placeholder for a Switchboard-like update; in a real sim this would target the oracle program.
    // For the harness we simply return a no-op instruction that the test validator can process.
    return new TransactionInstruction({
      keys: [
        { pubkey: oracle, isSigner: false, isWritable: true },
        { pubkey: payer, isSigner: true, isWritable: true },
      ],
      programId: new PublicKey("11111111111111111111111111111111"),
      data: Buffer.from([0, ...new anchor.BN(price).toArray("le", 8), ...new anchor.BN(timestamp).toArray("le", 8)]),
    });
  }

  static createLagInjectorConfig(lagMs: number, slotLag?: number): LagInjectorConfig {
    return {
      lagMs,
      slotLag,
    };
  }

  static async loadHistoricalSeries(
    connection: Connection,
    oracle: PublicKey,
    symbol: string,
    limit: number = 300
  ): Promise<HistoricalPriceSeries> {
    // In the pure-onchain sim we replay synthetic JitoSOL depeg data.
    // This stub returns a realistic last-three-depeg series (price in USD).
    const baseTime = Math.floor(Date.now() / 1000) - 3600;
    const prices: PriceData[] = [];
    for (let i = 0; i < limit; i++) {
      const t = baseTime + i * 15; // 15-second ticks
      let p = 1.0;
      // Simulate three distinct depeg windows that the breaker should catch
      if (i > 80 && i < 110) p = 0.87;           // first depeg
      else if (i > 160 && i < 190) p = 0.92;     // second depeg
      else if (i > 240 && i < 270) p = 0.81;     // third depeg
      prices.push({ price: p, timestamp: t });
    }
    return {
      symbol,
      oracle,
      prices,
    };
  }

  static sliceSeries(series: HistoricalPriceSeries, start: number, end?: number): HistoricalPriceSeries {
    return {
      ...series,
      prices: series.prices.slice(start, end),
    };
  }
}

export default OracleUtils;
