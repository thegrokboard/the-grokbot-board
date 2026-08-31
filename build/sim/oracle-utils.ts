import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import * as splToken from "@solana/spl-token";
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";

export const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6YgP7dJ");

export function getJitoSolPrice(connection: Connection, oraclePubkey: PublicKey): Promise<number> {
  // For the sim harness we replay known historical prices; this stub returns a synthetic value
  // that the lag injector will override via its own oracle update logic. Real implementation
  // would read a Switchboard or Pyth price account.
  return Promise.resolve(0.95);
}

export async function createTestVault(
  provider: AnchorProvider,
  program: Program<Vault>,
  owner: Keypair
): Promise<{ vault: PublicKey; buffer: PublicKey; jitoSolMint: PublicKey }> {
  const vault = anchor.web3.Keypair.generate();
  const buffer = anchor.web3.Keypair.generate();
  const jitoSolMint = JITO_SOL_MINT;

  // Create the protection buffer account (simple rent-exempt lamport holder)
  const bufferRent = await provider.connection.getMinimumBalanceForRentExemption(0);
  const createBufferIx = SystemProgram.createAccount({
    fromPubkey: provider.wallet.publicKey,
    newAccountPubkey: buffer.publicKey,
    lamports: bufferRent,
    space: 0,
    programId: SystemProgram.programId,
  });

  await provider.sendAndConfirm(new Transaction().add(createBufferIx), [buffer]);

  // Initialize the vault
  await program.methods
    .initialize(owner.publicKey, buffer.publicKey, new anchor.BN(500_000_000)) // 0.5 SOL buffer target
    .accounts({
      vault: vault.publicKey,
      authority: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([vault])
    .rpc();

  return { vault: vault.publicKey, buffer: buffer.publicKey, jitoSolMint };
}

export async function depositJitoSol(
  provider: AnchorProvider,
  program: Program<Vault>,
  vault: PublicKey,
  depositor: Keypair,
  amount: number
): Promise<void> {
  const ata = await splToken.getAssociatedTokenAddress(JITO_SOL_MINT, depositor.publicKey);
  
  // In a real test we'd create the ATA and mint tokens; for sim we assume funded ATA
  await program.methods
    .deposit(new anchor.BN(amount))
    .accounts({
      vault,
      depositor: depositor.publicKey,
      depositorTokenAccount: ata,
      tokenProgram: splToken.TOKEN_PROGRAM_ID,
    })
    .signers([depositor])
    .rpc();
}

export async function triggerDrawdownCheck(
  provider: AnchorProvider,
  program: Program<Vault>,
  vault: PublicKey,
  oraclePubkey: PublicKey
): Promise<void> {
  await program.methods
    .checkDrawdown()
    .accounts({
      vault,
      oracle: oraclePubkey,
      buffer: (await program.account.vault.fetch(vault)).buffer,
      authority: provider.wallet.publicKey,
    })
    .rpc();
}

export async function pauseVault(
  provider: AnchorProvider,
  program: Program<Vault>,
  vault: PublicKey,
  owner: Keypair
): Promise<void> {
  await program.methods
    .pause()
    .accounts({
      vault,
      owner: owner.publicKey,
    })
    .signers([owner])
    .rpc();
}

export async function withdrawFromBuffer(
  provider: AnchorProvider,
  program: Program<Vault>,
  vault: PublicKey,
  owner: Keypair,
  amount: number
): Promise<void> {
  await program.methods
    .withdrawBuffer(new anchor.BN(amount))
    .accounts({
      vault,
      owner: owner.publicKey,
      buffer: (await program.account.vault.fetch(vault)).buffer,
      destination: provider.wallet.publicKey,
    })
    .signers([owner])
    .rpc();
}
