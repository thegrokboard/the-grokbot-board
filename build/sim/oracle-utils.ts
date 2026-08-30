import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";

export interface OraclePrices {
  price: number;
  confidence: number;
  timestamp: number;
}

export function getJitoSolPrice(
  oracleAccount: any,
  slot: number
): OraclePrices {
  // Minimal real parser for a Switchboard-like or Pyth-style oracle account
  // that matches the expected layout used by the vault program.
  // In a real sim this would deserialize the full account; here we simulate
  // a price series that can be lagged.
  const now = Math.floor(Date.now() / 1000);
  const simulatedPrice = 0.95 + Math.sin(slot / 100) * 0.08; // around 0.87-1.03
  return {
    price: Math.max(0.7, Math.min(1.2, simulatedPrice)),
    confidence: 0.02,
    timestamp: now,
  };
}

export async function loadVaultProgram(
  provider: anchor.Provider
): Promise<Program<Vault>> {
  const idl = (await anchor.Program.fetchIdl(
    new PublicKey("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"), // placeholder - replaced at build
    provider
  )) as any;

  return new Program<Vault>(idl, provider);
}

export { TOKEN_PROGRAM_ID };
