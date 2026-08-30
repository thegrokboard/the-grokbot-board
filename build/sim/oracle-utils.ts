import * as anchor from "@coral-xyz/anchor";
import { Program, Wallet } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Re-export for lag-injector and others
export { Vault };

export interface OraclePrices {
  jitoSolPrice: number;
  timestamp: number;
  slot: number;
}

export const getJitoSolPrice = async (
  connection: Connection,
  oraclePubkey: PublicKey
): Promise<OraclePrices> => {
  // For the sim we replay historical JitoSOL prices.
  // In a real deployment this would read a Switchboard or Pyth oracle.
  // Here we return a placeholder that the lag injector will override.
  const slot = await connection.getSlot();
  return {
    jitoSolPrice: 0.95, // default depeg value used by injector
    timestamp: Date.now(),
    slot,
  };
};

export const createProtectionBuffer = async (
  program: Program<Vault>,
  owner: Keypair,
  vault: PublicKey,
  bufferAmount: number
): Promise<PublicKey> => {
  const [bufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protection_buffer"), vault.toBuffer()],
    program.programId
  );

  // The buffer account is a simple token account holding jitoSOL as protection
  await program.methods
    .initializeBuffer(new anchor.BN(bufferAmount))
    .accounts({
      owner: owner.publicKey,
      vault,
      buffer: bufferPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([owner])
    .rpc();

  return bufferPda;
};

export const checkDrawdown = async (
  program: Program<Vault>,
  vault: PublicKey,
  currentPrice: number,
  twap: number
): Promise<boolean> => {
  const tx = await program.methods
    .checkDrawdown(new anchor.BN(Math.floor(currentPrice * 1e9)), new anchor.BN(Math.floor(twap * 1e9)))
    .accounts({
      vault,
    })
    .rpc()
    .catch((e) => {
      if (e.toString().includes("DrawdownBreached")) {
        return true;
      }
      throw e;
    });

  return typeof tx === "boolean" ? tx : false;
};
