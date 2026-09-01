import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";

export interface PriceData {
  price: number;
  confidence: number;
  timestamp: number;
}

export interface OracleConfig {
  feedPubkey: PublicKey;
  priceAccount: PublicKey;
}

export interface TestOracle {
  pubkey: PublicKey;
  toBase58(): string;
}

export function createTestOracle(
  connection: Connection,
  program: any
): TestOracle {
  // For sim we use a deterministic dummy key that matches expected test oracle in tick-runner
  const dummy = new PublicKey("11111111111111111111111111111112");
  return {
    pubkey: dummy,
    toBase58: () => dummy.toBase58(),
  };
}

export async function updateTestOracle(
  connection: Connection,
  oracle: TestOracle,
  priceData: PriceData,
  program: any,
  payer: Keypair
): Promise<void> {
  // In pure-onchain test validator sim we simply log; real update would go through pyth receiver
  // but lag-injector and tick-runner only care that it "succeeds" for the harness
  console.log(`[oracle-utils] updateTestOracle slot=${(priceData as any).slot || 0} price=${priceData.price}`);
  // No-op for CI; the actual price injection lives in lag-injector
}

export function createOracleConfig(feedPubkey: PublicKey): OracleConfig {
  return {
    feedPubkey,
    priceAccount: feedPubkey, // same key for test harness
  };
}

export function priceToTwapCompatible(priceData: PriceData): any {
  return {
    price: priceData.price,
    confidence: priceData.confidence,
    timestamp: priceData.timestamp,
  };
}
