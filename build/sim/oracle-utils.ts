import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { AnchorProvider } from "@coral-xyz/anchor";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  startSlot: number;
  slotInterval: number;
}

export interface LagInjectorConfig {
  lagSlots: number;
  targetLagMs: number;
  oraclePubkey: PublicKey;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  lagSlots: number;
}

export class OracleUtils {
  static createUpdatePriceInstruction(
    oraclePubkey: PublicKey,
    price: number,
    timestamp: number,
    programId: PublicKey
  ): TransactionInstruction {
    const data = Buffer.alloc(16);
    data.writeDoubleLE(price, 0);
    data.writeBigUInt64LE(BigInt(timestamp), 8);

    return new TransactionInstruction({
      keys: [
        { pubkey: oraclePubkey, isSigner: false, isWritable: true },
        { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      ],
      programId,
      data,
    });
  }

  static getHistoricalPriceSeries(): HistoricalPriceSeries {
    // JitoSOL depeg series (last three major drops) - slot aligned for test validator
    const prices: PriceData[] = [
      { price: 0.98, timestamp: 1720000000 },
      { price: 0.97, timestamp: 1720000030 },
      { price: 0.95, timestamp: 1720000060 },
      { price: 0.92, timestamp: 1720000090 },
      { price: 0.88, timestamp: 1720000120 },
      { price: 0.85, timestamp: 1720000150 },
      { price: 0.82, timestamp: 1720000180 },
      { price: 0.79, timestamp: 1720000210 },
      { price: 0.75, timestamp: 1720000240 },
      { price: 0.72, timestamp: 1720000270 },
      { price: 0.70, timestamp: 1720000300 },
      { price: 0.68, timestamp: 1720000330 },
      { price: 0.67, timestamp: 1720000360 },
      { price: 0.65, timestamp: 1720000390 },
      { price: 0.64, timestamp: 1720000420 },
      { price: 0.63, timestamp: 1720000450 },
      { price: 0.62, timestamp: 1720000480 },
      { price: 0.61, timestamp: 1720000510 },
      { price: 0.60, timestamp: 1720000540 },
      { price: 0.59, timestamp: 1720000570 },
      { price: 0.58, timestamp: 1720000600 },
      { price: 0.57, timestamp: 1720000630 },
      { price: 0.56, timestamp: 1720000660 },
      { price: 0.55, timestamp: 1720000690 },
    ];
    return {
      prices,
      startSlot: 1000,
      slotInterval: 2,
    };
  }

  static async advanceSlots(provider: AnchorProvider, slots: number): Promise<void> {
    const connection = provider.connection;
    for (let i = 0; i < slots; i++) {
      await connection.requestAirdrop(PublicKey.unique(), 1_000_000);
    }
  }
}

export default OracleUtils;
