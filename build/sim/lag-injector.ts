import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection, Transaction, SystemProgram } from "@solana/web3.js";
import { OracleUtils, PriceData } from "./oracle-utils";

export class LagInjector {
  private connection: Connection;
  private oracleUtils: OracleUtils;
  private lagSlots: number;
  private jitoPriceFeed: PublicKey;
  private programId: PublicKey;

  constructor(
    connection: Connection,
    oracleUtils: OracleUtils,
    lagSeconds: number = 45,
    jitoPriceFeed: PublicKey,
    programId: PublicKey
  ) {
    this.connection = connection;
    this.oracleUtils = oracleUtils;
    this.lagSlots = Math.floor((lagSeconds * 2)); // rough 0.5s per slot
    this.jitoPriceFeed = jitoPriceFeed;
    this.programId = programId;
  }

  async injectLag(currentSlot: number, historicalPrices: Array<{price: number; timestamp: number}>): Promise<void> {
    const laggedSlot = Math.max(0, currentSlot - this.lagSlots);
    
    // Replay last three prices with lag
    for (let i = 0; i < Math.min(3, historicalPrices.length); i++) {
      const entry = historicalPrices[historicalPrices.length - 1 - i];
      const priceData: PriceData = {
        price: entry.price,
        confidence: 0.01, // 1% confidence
        slot: laggedSlot - i * 4, // spread across slots
        timestamp: new anchor.BN(entry.timestamp)
      };
      
      await this.oracleUtils.updateOracle(
        this.jitoPriceFeed,
        priceData,
        this.programId
      );
    }
  }

  async replaySeries(series: Array<{price: number; timestamp: number}>, startSlot: number): Promise<void> {
    let slot = startSlot;
    for (let i = 0; i < series.length; i++) {
      const entry = series[series.length - 1 - i];
      const priceData: PriceData = {
        price: entry.price,
        confidence: 0.005,
        slot: slot,
        timestamp: new anchor.BN(entry.timestamp)
      };
      
      await this.oracleUtils.updateOracle(
        this.jitoPriceFeed,
        priceData,
        this.programId
      );
      
      slot -= 2; // advance backwards in simulation
    }
  }

  getLagSlots(): number {
    return this.lagSlots;
  }
}
