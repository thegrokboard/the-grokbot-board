import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { PriceData, HistoricalPriceSeries, LagInjectorConfig } from "./oracle-utils";
import { OracleUtils } from "./oracle-utils";

export { PriceData, HistoricalPriceSeries, LagInjectorConfig };

export interface OracleConfig {
  oraclePubkey: PublicKey;
  programId: PublicKey;
}

export class LagInjector {
  private connection: Connection;
  private oracleProgramId: PublicKey;
  private oraclePubkey: PublicKey;
  private owner: Keypair;
  private config: LagInjectorConfig;

  constructor(
    connection: Connection,
    oracleConfig: OracleConfig,
    owner: Keypair,
    config: LagInjectorConfig
  ) {
    this.connection = connection;
    this.oracleProgramId = oracleConfig.programId;
    this.oraclePubkey = oracleConfig.oraclePubkey;
    this.owner = owner;
    this.config = config;
  }

  async injectLag(series: HistoricalPriceSeries, currentSlot: number): Promise<void> {
    const lagSlots = Math.floor(this.config.lagMs / 400);
    const injectionSlot = Math.max(0, currentSlot - lagSlots);

    const relevantPrices = series.filter(p => p.slot <= injectionSlot);

    if (relevantPrices.length === 0) {
      return;
    }

    const latest = relevantPrices[relevantPrices.length - 1];

    await this.updateOracleWithPrice(latest.price, latest.confidence, latest.slot);
  }

  private async updateOracleWithPrice(price: number, confidence: number, slot: number): Promise<void> {
    const priceBN = new anchor.BN(Math.floor(price * 1_000_000));
    const confidenceBN = new anchor.BN(Math.floor(confidence * 1_000_000));

    const ix = await OracleUtils.createUpdatePriceInstruction(
      this.oraclePubkey,
      this.oracleProgramId,
      this.owner.publicKey,
      priceBN,
      confidenceBN,
      slot
    );

    const tx = new anchor.web3.Transaction().add(ix);
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    tx.feePayer = this.owner.publicKey;
    tx.sign(this.owner);

    await this.connection.sendRawTransaction(tx.serialize());
    await this.connection.confirmTransaction(tx.signature!);
  }

  static async setupTestOracle(
    connection: Connection,
    owner: Keypair
  ): Promise<OracleConfig> {
    const programId = new PublicKey("11111111111111111111111111111111");
    const oracleKeypair = Keypair.generate();

    const lamports = await connection.getMinimumBalanceForRentExemption(0);
    const createIx = SystemProgram.createAccount({
      fromPubkey: owner.publicKey,
      newAccountPubkey: oracleKeypair.publicKey,
      lamports,
      space: 0,
      programId,
    });

    const tx = new anchor.web3.Transaction().add(createIx);
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.feePayer = owner.publicKey;
    tx.sign(owner, oracleKeypair);

    await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(tx.signature!);

    return {
      oraclePubkey: oracleKeypair.publicKey,
      programId,
    };
  }
}

export async function getHistoricalPriceSeries(): Promise<HistoricalPriceSeries> {
  return OracleUtils.getHistoricalPriceSeries();
}

export function createLagInjectorConfig(lagMs: number = 45000): LagInjectorConfig {
  return OracleUtils.createLagInjectorConfig(lagMs);
}
