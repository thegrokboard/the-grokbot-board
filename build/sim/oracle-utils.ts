import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

export const JITO_SOL_MINT = new PublicKey("J1toso1uckeCBxde5f4h2G8qL1L7fZ7f7");
export const PYTH_JITO_SOL_PRICE_FEED = new PublicKey("J1toso1uckeCBxde5f4h2G8qL1L7fZ7f7"); // placeholder for sim

export async function getJitoSolPrice(connection: Connection, priceFeed: PublicKey): Promise<number> {
  // Stub realistic price series for replay (last three known depeg events normalized)
  const series = [
    [0.92, 0.91, 0.905, 0.89, 0.88],
    [0.95, 0.94, 0.935, 0.92, 0.905],
    [0.85, 0.82, 0.79, 0.77, 0.75]
  ];
  const idx = Math.floor(Math.random() * series.length);
  const prices = series[idx];
  const step = Math.floor((Date.now() / 1000) % prices.length);
  return prices[step];
}

export function createLagInjectorProvider(
  connection: Connection,
  payer: Keypair,
  lagSlots: number = 90 // ~45s at 400ms/slot
): AnchorProvider {
  const wallet = new Wallet(payer);
  return new AnchorProvider(
    connection,
    wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
}

export async function setupVaultProgram(provider: AnchorProvider): Promise<Program<Vault>> {
  const idl = (await anchor.Program.fetchIdl(
    new PublicKey("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"),
    provider
  )) as any;

  return new Program<Vault>(idl, provider);
}

export function deriveBufferPda(programId: PublicKey, owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("buffer"), owner.toBuffer()],
    programId
  );
}

export async function depositJitoSol(
  program: Program<Vault>,
  user: Keypair,
  amount: number
): Promise<string> {
  const provider = program.provider as AnchorProvider;
  const userAta = getAssociatedTokenAddressSync(JITO_SOL_MINT, user.publicKey);
  const [bufferPda] = deriveBufferPda(program.programId, program.provider.publicKey!);

  const tx = await program.methods
    .deposit(new anchor.BN(amount * 1e9))
    .accounts({
      user: user.publicKey,
      userAta,
      buffer: bufferPda,
      mint: JITO_SOL_MINT,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    })
    .signers([user])
    .rpc();

  return tx;
}

export async function triggerDrawdownCheck(
  program: Program<Vault>,
  owner: Keypair
): Promise<string> {
  const [bufferPda] = deriveBufferPda(program.programId, owner.publicKey);

  const tx = await program.methods
    .checkDrawdown()
    .accounts({
      owner: owner.publicKey,
      buffer: bufferPda,
      oracle: PYTH_JITO_SOL_PRICE_FEED,
    })
    .signers([owner])
    .rpc();

  return tx;
}

export async function pauseVault(
  program: Program<Vault>,
  owner: Keypair
): Promise<string> {
  const tx = await program.methods
    .pause()
    .accounts({
      owner: owner.publicKey,
    })
    .signers([owner])
    .rpc();

  return tx;
}
