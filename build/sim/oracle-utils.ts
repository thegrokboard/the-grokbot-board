import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";

export interface PriceData {
  price: number;
  confidence: number;
  timestamp: number;
}

export interface OracleConfig {
  oracleProgramId: PublicKey;
  priceAccount: PublicKey;
  admin: PublicKey;
}

export class TestOracle {
  public readonly pubkey: PublicKey;
  private data: PriceData;

  constructor(pubkey: PublicKey, initialPrice: number = 1.0) {
    this.pubkey = pubkey;
    this.data = {
      price: initialPrice,
      confidence: 0.01,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  public getPriceData(): PriceData {
    return { ...this.data };
  }

  public update(price: number, confidence: number = 0.01, timestamp?: number): void {
    this.data = {
      price,
      confidence,
      timestamp: timestamp ?? Math.floor(Date.now() / 1000),
    };
  }

  public toBase58(): string {
    return this.pubkey.toBase58();
  }
}

export function createTestOracle(initialPrice: number = 1.0): TestOracle {
  const keypair = Keypair.generate();
  return new TestOracle(keypair.publicKey, initialPrice);
}

export async function updateTestOracle(
  oracle: TestOracle,
  price: number,
  confidence: number = 0.01,
  timestamp?: number
): Promise<void> {
  oracle.update(price, confidence, timestamp);
}

export function createPriceAccount(
  program: Program,
  oracle: TestOracle,
  price: number,
  confidence: number = 0.01,
  timestamp?: number
): void {
  oracle.update(price, confidence, timestamp);
}

export function updatePriceAccount(
  program: Program,
  oracle: TestOracle,
  price: number,
  confidence: number = 0.01,
  timestamp?: number
): void {
  oracle.update(price, confidence, timestamp);
}

// Minimal stub for @pythnetwork/pyth-solana-receiver to satisfy the import in dependent files
export const pythSolanaReceiver = {
  getPythProgramKeyForCluster: () => new PublicKey("FsJ3A3u2vn5cTVofAjn4fX3sA4vJ6f1fZ3z3z3z3z3z"), // dummy
  parsePriceFeedUpdates: () => ({}),
};

export default {
  createTestOracle,
  updateTestOracle,
  createPriceAccount,
  updatePriceAccount,
  TestOracle,
  PriceData: {} as any,
  OracleConfig: {} as any,
};
