import * as anchor from "@coral-xyz/anchor";
import { Program, Wallet, AnchorProvider } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { Connection, PublicKey, Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

export const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn");
export const ORACLE_FEED = new PublicKey("8oR7q3vR6oq3o6vJ9k3kYqG1Z1z1Z1z1Z1z1Z1z1Z1z"); // placeholder for sim
export const VAULT_PDA_SEED = "vault";
export const BUFFER_PDA_SEED = "protection_buffer";

export interface PriceData {
  price: number;
  confidence: number;
  timestamp: number;
}

export function getJitoSolPrice(connection: Connection, feed: PublicKey = ORACLE_FEED): Promise<PriceData> {
  // Simulated price fetch - in real use would call Pyth or Switchboard
  // For the sim harness we replay historical Jito depeg series
  return Promise.resolve({
    price: 0.92, // default depegged value for testing
    confidence: 0.01,
    timestamp: Date.now() / 1000,
  });
}

export async function createVault(
  provider: AnchorProvider,
  program: Program<Vault>,
  owner: Keypair
): Promise<PublicKey> {
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(VAULT_PDA_SEED), owner.publicKey.toBuffer()],
    program.programId
  );

  const [bufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(BUFFER_PDA_SEED), vaultPda.toBuffer()],
    program.programId
  );

  const jitoAta = getAssociatedTokenAddressSync(JITO_SOL_MINT, vaultPda, true);

  await program.methods
    .initialize()
    .accounts({
      vault: vaultPda,
      buffer: bufferPda,
      owner: owner.publicKey,
      jitoMint: JITO_SOL_MINT,
      jitoVaultAta: jitoAta,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([owner])
    .rpc();

  return vaultPda;
}

export function getVaultProgram(provider: AnchorProvider): Program<Vault> {
  const idl = require("../target/idl/vault.json");
  return new Program<Vault>(idl, provider);
}

export async function buildProvider(connection: Connection, payer: Keypair): Promise<AnchorProvider> {
  const wallet = new Wallet(payer);
  return new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

export function parseHistoricalPriceSeries(csvLines: string[]): PriceData[] {
  return csvLines.map((line, i) => {
    const [ts, priceStr] = line.split(",");
    return {
      price: parseFloat(priceStr),
      confidence: 0.005,
      timestamp: parseInt(ts) || (Date.now() / 1000 - (100 - i) * 15),
    };
  });
}

export const JITO_DEPEG_SERIES_1: string[] = [
  "1725000000,0.98",
  "1725000015,0.95",
  "1725000030,0.89",
  "1725000045,0.82",
  "1725000060,0.78",
];

export const JITO_DEPEG_SERIES_2: string[] = [
  "1725100000,1.01",
  "1725100015,0.99",
  "1725100030,0.94",
  "1725100045,0.85",
  "1725100060,0.81",
];
