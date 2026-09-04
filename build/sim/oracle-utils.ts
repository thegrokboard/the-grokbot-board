import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";

export interface PriceData {
  price: number;
  confidence: number;
  timestamp: number;
  slot: number;
}

export class OracleUtils {
  private connection: Connection;
  private oraclePubkey: PublicKey;
  private programId: PublicKey;

  constructor(connection: Connection, oraclePubkey: PublicKey, programId: PublicKey) {
    this.connection = connection;
    this.oraclePubkey = oraclePubkey;
    this.programId = programId;
  }

  async getLatestPrice(): Promise<PriceData> {
    // In test-validator sim we read from on-chain oracle account (Switchboard-style or custom)
    const accountInfo = await this.connection.getAccountInfo(this.oraclePubkey);
    if (!accountInfo) {
      throw new Error("Oracle account not found");
    }
    // Minimal dummy decoder for sim - real implementation would parse Switchboard or Pyth account
    const now = Math.floor(Date.now() / 1000);
    return {
      price: 0.95, // default depeg sim value
      confidence: 0.02,
      timestamp: now,
      slot: 12345678,
    };
  }

  async setPrice(price: number, timestamp?: number, slot?: number): Promise<void> {
    // In pure-onchain test-validator harness this updates a mock oracle account owned by the program
    const currentSlot = slot || 12345678;
    const ts = timestamp || Math.floor(Date.now() / 1000);

    // For sim we just log; real implementation would call an update instruction on the oracle program
    console.log(`[OracleUtils] setPrice called: $${price.toFixed(4)} at slot ${currentSlot}, ts ${ts}`);
    
    // In full harness this would send a transaction to update the oracle account data
    // e.g. via program.methods.updateOracle(...).accounts({...}).rpc();
  }

  getOraclePubkey(): PublicKey {
    return this.oraclePubkey;
  }

  static createTestOracle(connection: Connection, programId: PublicKey): OracleUtils {
    // For sim we use a deterministic well-known key
    const oracleKey = new PublicKey("11111111111111111111111111111112");
    return new OracleUtils(connection, oracleKey, programId);
  }
}

export default OracleUtils;
