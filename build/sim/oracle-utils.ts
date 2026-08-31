import * as anchor from "@coral-xyz/anchor";
import { Program, Wallet } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { Connection, PublicKey, Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import * as splToken from "@solana/spl-token";

export interface OraclePrices {
  jitoSolPrice: number;
  timestamp: number;
  slot: number;
}

export async function getJitoSolPrice(
  connection: Connection,
  oraclePubkey: PublicKey,
  program: Program<Vault>
): Promise<OraclePrices> {
  // For simulation we read a mocked price account (in real use this would be a Switchboard or Pyth feed)
  const accountInfo = await connection.getAccountInfo(oraclePubkey);
  if (!accountInfo) {
    // Default to a plausible JitoSOL price near 1.0 with slight depeg for testing
    return {
      jitoSolPrice: 0.987,
      timestamp: Math.floor(Date.now() / 1000),
      slot: (await connection.getSlot()) - 10,
    };
  }

  // In a real oracle integration we would deserialize here.
  // For the harness we return deterministic values based on slot for replayability.
  const slot = await connection.getSlot();
  const basePrice = 1.0;
  const depegFactor = Math.sin(slot / 50) * 0.018; // creates realistic oscillation around 1.0
  return {
    jitoSolPrice: parseFloat((basePrice + depegFactor).toFixed(4)),
    timestamp: Math.floor(Date.now() / 1000),
    slot,
  };
}

export function createMockOracle(
  connection: Connection,
  payer: Keypair
): Promise<PublicKey> {
  // In the test validator we simply return a deterministic PDA that the lag injector will "update"
  const [oraclePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), Buffer.from("jitosol")],
    anchor.web3.SystemProgram.programId
  );
  return Promise.resolve(oraclePda);
}

export async function updateMockOracle(
  connection: Connection,
  program: Program<Vault>,
  payer: Keypair,
  oracle: PublicKey,
  price: number
): Promise<string> {
  // Simulate writing a price by sending a no-op transaction (in a full harness this would call an update ix)
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: payer.publicKey,
      lamports: 1,
    })
  );
  const sig = await anchor.web3.sendAndConfirmTransaction(connection, tx, [payer]);
  return sig;
}

// Re-export for convenience
export { splToken };
