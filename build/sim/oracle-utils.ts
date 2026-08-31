import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair, Transaction, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Vault } from "../target/types/vault";

export interface OraclePrices {
  jitoSolPrice: number;
  timestamp: number;
  slot: number;
}

export const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn");
export const PYTH_JITOSOL_PRICE_FEED = new PublicKey("2oL1C3T8zK8zqJ4vL3z3zqJ4vL3z3zqJ4vL3z3zqJ4v"); // placeholder for sim
export const SWITCHBOARD_JITOSOL_FEED = new PublicKey("3kR3v7z3zqJ4vL3z3zqJ4vL3z3zqJ4vL3z3zqJ4vL3z"); // placeholder

export async function getJitoSolPrice(
  connection: Connection,
  provider: AnchorProvider
): Promise<OraclePrices> {
  // For simulation we generate synthetic lagged prices based on replay series.
  // In real deployment this would call Pyth/Switchboard onchain.
  const slot = await connection.getSlot();
  const timestamp = Math.floor(Date.now() / 1000);

  // Synthetic price around 0.9 with small variance for testing depegs
  const basePrice = 0.92;
  const variance = (Math.random() - 0.5) * 0.08;
  const price = Math.max(0.75, Math.min(1.05, basePrice + variance));

  return {
    jitoSolPrice: price,
    timestamp,
    slot,
  };
}

export function createProtectionBufferPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("protection_buffer")],
    programId
  );
}

export function createVaultStatePda(programId: PublicKey, owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state"), owner.toBuffer()],
    programId
  );
}

export async function getOrCreateAssociatedTokenAccount(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  const accountInfo = await connection.getAccountInfo(ata);
  
  if (!accountInfo) {
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        ata,
        owner,
        mint
      )
    );
    await anchor.web3.sendAndConfirmTransaction(connection, tx, [payer]);
  }
  
  return ata;
}

function createAssociatedTokenAccountInstruction(
  payer: PublicKey,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey
): anchor.web3.TransactionInstruction {
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: ata, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return new anchor.web3.TransactionInstruction({
    keys,
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    data: Buffer.alloc(0),
  });
}

export function loadVaultProgram(provider: AnchorProvider): Program<Vault> {
  // The IDL is loaded via the generated types
  return new Program<Vault>(
    require("../target/idl/vault.json"),
    provider
  );
}
