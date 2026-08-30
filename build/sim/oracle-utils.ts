import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from "@solana/spl-token";

export interface OraclePrices {
  jitoSolPrice: number;
  timestamp: number;
  slot: number;
}

export async function getJitoSolPrice(
  connection: Connection,
  jitoSolMint: PublicKey = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCP"),
  oracleFeed: PublicKey = new PublicKey("8V9Y9yYac6Y7kGCPj1toso1uCk3RLmjorhTtrVw") // placeholder for sim
): Promise<OraclePrices> {
  // For simulation replay we return synthetic prices; real impl would read Pyth/Switchboard
  const slot = await connection.getSlot();
  const timestamp = Math.floor(Date.now() / 1000);
  
  // Simulated depeg series for testing (will be driven by lag-injector)
  const basePrice = 0.95 + (Math.sin(timestamp / 3600) * 0.08);
  const price = Math.max(0.75, Math.min(1.05, basePrice));
  
  return {
    jitoSolPrice: price,
    timestamp,
    slot,
  };
}

export function createLagInjectedPrice(
  basePrice: number,
  lagSlots: number,
  currentSlot: number
): OraclePrices {
  const lagFactor = Math.max(0, 1 - (lagSlots / 200)); // 45s ~90 slots at 0.5s/slot
  const injectedPrice = basePrice * (0.85 + lagFactor * 0.2);
  
  return {
    jitoSolPrice: Math.max(0.6, injectedPrice),
    timestamp: Math.floor(Date.now() / 1000),
    slot: currentSlot,
  };
}

export async function setupVaultProvider(): Promise<{
  provider: AnchorProvider;
  program: Program<Vault>;
  payer: Keypair;
}> {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  
  // Use default test validator keypair for sim
  const payer = Keypair.fromSecretKey(
    new Uint8Array([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]) // placeholder - in practice loaded from env
  );
  
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);
  
  const program = anchor.workspace.Vault as Program<Vault>;
  
  return { provider, program, payer };
}

export function getVaultPdas(programId: PublicKey, owner: PublicKey) {
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.toBuffer()],
    programId
  );
  
  const [bufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protection_buffer"), vaultPda.toBuffer()],
    programId
  );
  
  return { vaultPda, bufferPda };
}
