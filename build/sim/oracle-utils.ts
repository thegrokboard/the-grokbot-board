import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction, Connection } from "@solana/web3.js";
import { BN } from "bn.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  oraclePubkey: PublicKey;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  lagMs: number;
  updateFrequencyMs: number;
}

export interface LagInjectorConfig {
  lagMs: number;
  series: HistoricalPriceSeries;
  oracleConfig: OracleConfig;
}

export class OracleUtils {
  static createPriceData(price: number, timestamp: number): PriceData {
    return { price, timestamp };
  }

  static createHistoricalPriceSeries(
    prices: PriceData[],
    oraclePubkey: PublicKey
  ): HistoricalPriceSeries {
    return { prices, oraclePubkey };
  }

  static createOracleConfig(
    oraclePubkey: PublicKey,
    lagMs: number = 45000,
    updateFrequencyMs: number = 15000
  ): OracleConfig {
    return { oraclePubkey, lagMs, updateFrequencyMs };
  }

  static createLagInjectorConfig(
    lagMs: number,
    series: HistoricalPriceSeries,
    oracleConfig: OracleConfig
  ): LagInjectorConfig {
    return { lagMs, series, oracleConfig };
  }

  static async createUpdatePriceInstruction(
    program: any,
    oraclePubkey: PublicKey,
    priceData: PriceData
  ): Promise<TransactionInstruction> {
    // Minimal placeholder for on-chain oracle update (in real sim this would call the vault or a mock oracle program)
    return new TransactionInstruction({
      keys: [{ pubkey: oraclePubkey, isSigner: false, isWritable: true }],
      programId: program.programId,
      data: Buffer.from([1, ...new BN(priceData.price).toArray("le", 8)]),
    });
  }

  static calculateTWAP(prices: PriceData[], windowMs: number = 15000): number {
    if (prices.length === 0) return 0;
    const now = Date.now();
    const windowStart = now - windowMs;
    const relevant = prices.filter((p) => p.timestamp >= windowStart);
    if (relevant.length === 0) return prices[prices.length - 1].price;
    const sum = relevant.reduce((acc, p) => acc + p.price, 0);
    return sum / relevant.length;
  }
}

export class LagInjector {
  private config: LagInjectorConfig;
  private connection: Connection;
  private program: any;

  constructor(
    config: LagInjectorConfig,
    connection: Connection,
    program: any
  ) {
    this.config = config;
    this.connection = connection;
    this.program = program;
  }

  async injectSeries(
    provider: anchor.Provider,
    startSlot: number
  ): Promise<void> {
    const { series, lagMs } = this.config;
    const oraclePubkey = series.oraclePubkey;

    for (let i = 0; i < series.prices.length; i++) {
      const priceData = series.prices[i];
      const laggedTimestamp = priceData.timestamp + lagMs;
      const laggedPriceData = OracleUtils.createPriceData(
        priceData.price,
        laggedTimestamp
      );

      const ix = await OracleUtils.createUpdatePriceInstruction(
        this.program,
        oraclePubkey,
        laggedPriceData
      );

      const tx = await anchor.web3.sendAndConfirmTransaction(
        this.connection,
        new anchor.web3.Transaction().add(ix),
        [anchor.web3.Keypair.generate()] // dummy signer for test harness
      );
      console.log(`Injected lagged price at slot ~${startSlot + i}: ${priceData.price}`);
    }
  }

  updateOracleWithLag(priceData: PriceData): Promise<string> {
    const lagged = OracleUtils.createPriceData(
      priceData.price,
      priceData.timestamp + this.config.lagMs
    );
    return OracleUtils.createUpdatePriceInstruction(
      this.program,
      this.config.series.oraclePubkey,
      lagged
    ).then((ix) =>
      this.connection
        .sendRawTransaction(ix.data)
        .then((sig) => {
          console.log(`Lag update sent: ${sig}`);
          return sig;
        })
    );
  }
}

export { OracleUtils, LagInjector };
