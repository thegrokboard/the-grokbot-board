import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";

export interface PriceData {
  price: number;
  confidence: number;
  slot: number;
  timestamp: number;
}

export class OracleUtils {
  private connection: Connection;
  private programId: PublicKey;
  private oracleAccount: PublicKey;

  constructor(connection: Connection, programId: PublicKey, oracleAccount: PublicKey) {
    this.connection = connection;
    this.programId = programId;
    this.oracleAccount = oracleAccount;
  }

  async getLatestPrice(): Promise<PriceData> {
    // Simulate latest price from on-chain oracle (in test validator context)
    const accountInfo = await this.connection.getAccountInfo(this.oracleAccount);
    if (!accountInfo) {
      return {
        price: 0.95,
        confidence: 0.02,
        slot: 0,
        timestamp: Math.floor(Date.now() / 1000),
      };
    }
    // Minimal mock decode for sim; real Pyth would parse here
    return {
      price: 0.95,
      confidence: 0.02,
      slot: 100,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  async updateOracle(price: number, slot: number, timestamp: number): Promise<void> {
    // In test-validator sim we just log; real harness would CPI or use test helper
    console.log(`[OracleUtils] Updating oracle to price=${price} at slot=${slot}, ts=${timestamp}`);
    // No-op on real account for pure sim; lag-injector will drive via replay
  }

  static createTestOracle(connection: Connection): OracleUtils {
    // Hardcoded test keys matching Anchor.toml test validator setup
    const programId = new PublicKey("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");
    const oracleAccount = new PublicKey("11111111111111111111111111111111");
    return new OracleUtils(connection, programId, oracleAccount);
  }
}

export { OracleUtils, PriceData };
