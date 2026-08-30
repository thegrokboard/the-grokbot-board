import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet, Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { Vault } from "../target/types/vault";

export interface OraclePrices {
  jitoSolPrice: number;
  timestamp: number;
  slot: number;
}

export const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCP");
export const PYTH_JITO_SOL_PRICE_FEED = new PublicKey("3fJ7v6fZ3q4v6f3fY3q4v6f3fY3q4v6f3fY3q4v6f3f"); // placeholder for sim

export function loadVaultProgram(provider: AnchorProvider): Program<Vault> {
  const idl = require("../target/idl/vault.json");
  return new Program(idl as Idl, provider);
}

export async function getJitoSolPrice(
  connection: Connection,
  oraclePubkey: PublicKey = PYTH_JITO_SOL_PRICE_FEED
): Promise<OraclePrices> {
  // Simulate realistic price fetch with slot timing (for replay)
  const slot = await connection.getSlot();
  const timestamp = Math.floor(Date.now() / 1000);
  
  // Default to ~1.0 with small variance for testing depegs
  let price = 1.0;
  const variance = (Math.random() - 0.5) * 0.05;
  price = Math.max(0.7, Math.min(1.3, price + variance));
  
  return {
    jitoSolPrice: price,
    timestamp,
    slot,
  };
}

export function createLagInjectorProvider(
  connection: Connection,
  wallet: Keypair,
  lagSlots: number = 225 // ~45s at 200ms/slot
): AnchorProvider {
  const anchorWallet = new Wallet(wallet);
  const provider = new AnchorProvider(
    connection,
    anchorWallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  
  // Monkey-patch to simulate lag by delaying oracle reads
  const originalGetAccountInfo = connection.getAccountInfo.bind(connection);
  connection.getAccountInfo = async (pubkey: PublicKey, commitment?: any) => {
    if (pubkey.equals(PYTH_JITO_SOL_PRICE_FEED)) {
      await new Promise((r) => setTimeout(r, 200)); // simulate lag
    }
    return originalGetAccountInfo(pubkey, commitment);
  };
  
  return provider;
}

export async function setupTestVault(
  provider: AnchorProvider,
  owner: Keypair
): Promise<{
  vault: PublicKey;
  buffer: PublicKey;
  program: Program<Vault>;
}> {
  const program = loadVaultProgram(provider);
  
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.publicKey.toBuffer()],
    program.programId
  );
  
  const [buffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("protection_buffer"), vault.toBuffer()],
    program.programId
  );
  
  // Initialize if needed (idempotent in sim)
  try {
    await program.methods
      .initialize()
      .accounts({
        vault,
        owner: owner.publicKey,
        buffer,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();
  } catch (e) {
    // Already initialized is ok in replay
    if (!e.toString().includes("already in use")) {
      console.warn("Vault init warning:", e);
    }
  }
  
  return { vault, buffer, program };
}

export function generateDepegSeries(
  basePrice: number = 1.0,
  length: number = 30,
  depegAt: number = 15,
  depegSeverity: number = 0.35
): OraclePrices[] {
  const series: OraclePrices[] = [];
  const now = Math.floor(Date.now() / 1000);
  
  for (let i = 0; i < length; i++) {
    let price = basePrice;
    const slot = 100000 + i * 5;
    
    if (i >= depegAt) {
      const progress = (i - depegAt) / (length - depegAt);
      price = basePrice * (1 - depegSeverity * Math.min(1, progress * 1.8));
    } else {
      price += (Math.sin(i) * 0.02);
    }
    
    series.push({
      jitoSolPrice: Math.max(0.6, price),
      timestamp: now - (length - i) * 15,
      slot,
    });
  }
  
  return series;
}
