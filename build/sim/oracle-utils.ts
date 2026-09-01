import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import { createAccount, createMint, mintTo } from "@solana/spl-token";

export interface OracleConfig {
  feedPubkey: PublicKey;
  programId: PublicKey;
}

export interface PriceData {
  price: number;
  confidence: number;
  timestamp: number;
  slot: number;
}

export const PYTH_PROGRAM_ID = new PublicKey("FsJ3A3u2vn5cTVofAjvy6y5kwAB9fW9T6VvK7J4pE6X");

export async function createPriceAccount(
  connection: Connection,
  payer: Keypair,
  oracleProgramId: PublicKey = PYTH_PROGRAM_ID
): Promise<PublicKey> {
  const priceAccount = Keypair.generate();
  const lamports = await connection.getMinimumBalanceForRentExemption(3312);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: priceAccount.publicKey,
      lamports,
      space: 3312,
      programId: oracleProgramId,
    })
  );

  await anchor.web3.sendAndConfirmTransaction(connection, tx, [payer, priceAccount]);
  return priceAccount.publicKey;
}

export async function updatePriceAccount(
  connection: Connection,
  payer: Keypair,
  feedPubkey: PublicKey,
  priceData: PriceData,
  oracleProgramId: PublicKey = PYTH_PROGRAM_ID
): Promise<void> {
  // In a real sim we would call the oracle program's update instruction.
  // For this harness we simulate by assuming the account reflects the new data.
  // The lag injector will drive the price feed via RPC or local state.
  console.log(`Updated price feed ${feedPubkey.toBase58()} to price=${priceData.price} slot=${priceData.slot}`);
}

export function getOracleConfig(feedPubkey: PublicKey): OracleConfig {
  return {
    feedPubkey,
    programId: PYTH_PROGRAM_ID,
  };
}

export function parsePriceData(accountInfo: any): PriceData {
  // Minimal parser for sim - real Pyth accounts have a specific layout.
  // We accept the data shape that the rest of the sim expects.
  return {
    price: accountInfo.price || 0,
    confidence: accountInfo.confidence || 0,
    timestamp: accountInfo.timestamp || 0,
    slot: accountInfo.slot || 0,
  };
}
