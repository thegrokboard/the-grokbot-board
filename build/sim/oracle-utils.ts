import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair, TransactionInstruction } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  name: string;
  prices: PriceData[];
}

export interface LagInjectorConfig {
  lagSlots: number;
  targetLagSeconds: number;
  oraclePubkey: PublicKey;
  feedName: string;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  updateInterval: number;
  lagSlots?: number;
}

export class OracleUtils {
  private connection: Connection;
  private program: Program;

  constructor(connection: Connection, program: Program) {
    this.connection = connection;
    this.program = program;
  }

  static getHistoricalPriceSeries(): HistoricalPriceSeries[] {
    // Last three JitoSOL depeg price series (realistic synthetic data for sim)
    return [
      {
        name: "jito-depeg-1",
        prices: [
          { price: 0.98, timestamp: 1700000000 },
          { price: 0.97, timestamp: 1700000015 },
          { price: 0.95, timestamp: 1700000030 },
          { price: 0.92, timestamp: 1700000045 },
          { price: 0.90, timestamp: 1700000060 },
          { price: 0.89, timestamp: 1700000075 },
          { price: 0.88, timestamp: 1700000090 },
          { price: 0.87, timestamp: 1700000105 },
        ],
      },
      {
        name: "jito-depeg-2",
        prices: [
          { price: 1.02, timestamp: 1700001000 },
          { price: 1.01, timestamp: 1700001015 },
          { price: 0.98, timestamp: 1700001030 },
          { price: 0.94, timestamp: 1700001045 },
          { price: 0.91, timestamp: 1700001060 },
          { price: 0.90, timestamp: 1700001075 },
          { price: 0.89, timestamp: 1700001090 },
        ],
      },
      {
        name: "jito-depeg-3",
        prices: [
          { price: 0.99, timestamp: 1700002000 },
          { price: 0.97, timestamp: 1700002015 },
          { price: 0.96, timestamp: 1700002030 },
          { price: 0.93, timestamp: 1700002045 },
          { price: 0.88, timestamp: 1700002060 },
          { price: 0.85, timestamp: 1700002075 },
          { price: 0.84, timestamp: 1700002090 },
          { price: 0.83, timestamp: 1700002105 },
          { price: 0.82, timestamp: 1700002120 },
        ],
      },
    ];
  }

  async updateOracleWithLag(
    oraclePubkey: PublicKey,
    priceData: PriceData,
    lagSlots: number
  ): Promise<void> {
    // In test-validator sim we just advance the clock and send a mock update
    const slot = await this.connection.getSlot();
    const laggedSlot = slot - lagSlots;
    console.log(`[OracleUtils] Updating oracle ${oraclePubkey.toBase58()} with price ${priceData.price} at lagged slot ${laggedSlot}`);
    // Real implementation would call the Switchboard or Pyth update instruction here
    // For pure on-chain sim we rely on test validator clock drift
  }

  createPriceUpdateInstruction(series: HistoricalPriceSeries, index: number): TransactionInstruction {
    // Placeholder for the on-chain oracle update IX (vault program uses this)
    const data = Buffer.from([0, index]); // mock discriminator
    return new TransactionInstruction({
      keys: [{ pubkey: this.program.programId, isSigner: false, isWritable: true }],
      programId: this.program.programId,
      data,
    });
  }
}

export class LagInjector {
  private config: LagInjectorConfig;
  private oracleUtils: OracleUtils;
  private injectedSeries: HistoricalPriceSeries[] = [];

  constructor(config: LagInjectorConfig, oracleUtils: OracleUtils) {
    this.config = config;
    this.oracleUtils = oracleUtils;
  }

  async injectSeries(series: HistoricalPriceSeries[]): Promise<void> {
    this.injectedSeries = series;
    console.log(`[LagInjector] Injected ${series.length} historical series with ${this.config.targetLagSeconds}s target lag`);
    for (const s of series) {
      console.log(`  Series '${s.name}' contains ${s.prices.length} price points`);
    }
  }

  getInjectedSeries(): HistoricalPriceSeries[] {
    return this.injectedSeries;
  }

  async updateOracleWithLag(price: PriceData): Promise<void> {
    await this.oracleUtils.updateOracleWithLag(
      this.config.oraclePubkey,
      price,
      this.config.lagSlots
    );
  }

  getLagSlots(): number {
    return this.config.lagSlots;
  }
}

// Singleton helpers to keep tests simple
let oracleUtilsInstance: OracleUtils | null = null;
let lagInjectorInstance: LagInjector | null = null;

export const OracleUtilsSingleton = {
  getInstance: (connection?: Connection, program?: Program): OracleUtils => {
    if (!oracleUtilsInstance && connection && program) {
      oracleUtilsInstance = new OracleUtils(connection, program);
    }
    if (!oracleUtilsInstance) {
      throw new Error("OracleUtils not initialized");
    }
    return oracleUtilsInstance;
  },
  reset: () => {
    oracleUtilsInstance = null;
  },
};

export const LagInjectorSingleton = {
  getInstance: (config?: LagInjectorConfig, oracleUtils?: OracleUtils): LagInjector => {
    if (!lagInjectorInstance && config && oracleUtils) {
      lagInjectorInstance = new LagInjector(config, oracleUtils);
    }
    if (!lagInjectorInstance) {
      throw new Error("LagInjector not initialized");
    }
    return lagInjectorInstance;
  },
  reset: () => {
    lagInjectorInstance = null;
  },
};

// Re-export main classes for direct import where needed
export { OracleUtils, LagInjector };
