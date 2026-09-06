import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair, TransactionInstruction } from "@solana/web3.js";
import { PythSolanaReceiver, getPythProgramKeyForCluster } from "@pythnetwork/pyth-solana-receiver";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  asset: string;
}

export interface LagInjectorConfig {
  lagMs: number;
  slotLag: number;
  oracleProgramId: PublicKey;
  priceFeedId: PublicKey;
  payer: Keypair;
}

export interface OracleConfig {
  oracleProgramId: PublicKey;
  priceFeedId: PublicKey;
  updateIntervalMs: number;
}

export class OracleUtils {
  static createPriceData(price: number, timestamp: number): PriceData {
    return { price, timestamp };
  }

  static createHistoricalPriceSeries(prices: PriceData[], asset: string = "jitoSOL"): HistoricalPriceSeries {
    return { prices, asset };
  }

  static createLagInjectorConfig(
    lagMs: number = 45000,
    slotLag: number = 90,
    oracleProgramId: PublicKey = getPythProgramKeyForCluster("localnet"),
    priceFeedId: PublicKey = new PublicKey("J1tP4xR4vKz7z7z7z7z7z7z7z7z7z7z7z7z7z7z7z"), // placeholder for jitoSOL
    payer: Keypair = Keypair.generate()
  ): LagInjectorConfig {
    return { lagMs, slotLag, oracleProgramId, priceFeedId, payer };
  }

  static createOracleConfig(
    oracleProgramId: PublicKey = getPythProgramKeyForCluster("localnet"),
    priceFeedId: PublicKey = new PublicKey("J1tP4xR4vKz7z7z7z7z7z7z7z7z7z7z7z7z7z7z7z"),
    updateIntervalMs: number = 15000
  ): OracleConfig {
    return { oracleProgramId, priceFeedId, updateIntervalMs };
  }

  static async getHistoricalPriceSeries(
    connection: Connection,
    priceFeedId: PublicKey,
    numSamples: number = 100
  ): Promise<HistoricalPriceSeries> {
    // Simulated replay of last three Jito depeg price series for test validator
    const now = Math.floor(Date.now() / 1000);
    const prices: PriceData[] = [];
    for (let i = numSamples - 1; i >= 0; i--) {
      const t = now - i * 15;
      // Depeg pattern: stable ~1.0 then sudden drop to ~0.92 with recovery
      let p = 1.0;
      if (i < 30) p = 0.92 + (30 - i) * 0.0027; // recovery
      else if (i < 45) p = 0.92;
      else if (i < 55) p = 1.0 - (i - 45) * 0.016; // depeg ramp
      prices.push({ price: Math.max(p, 0.85), timestamp: t });
    }
    return { prices: prices.reverse(), asset: "jitoSOL" };
  }

  static createUpdatePriceInstruction(
    programId: PublicKey,
    priceFeedId: PublicKey,
    priceData: PriceData,
    payer: Keypair
  ): TransactionInstruction {
    // Stub instruction for test harness; real sim uses Pyth receiver in lag injector
    const keys = [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: priceFeedId, isSigner: false, isWritable: true },
    ];
    const data = Buffer.from([0, ...new anchor.BN(priceData.price * 1e8).toArray("le", 8)]);
    return new TransactionInstruction({
      keys,
      programId,
      data,
    });
  }
}

export default OracleUtils;
