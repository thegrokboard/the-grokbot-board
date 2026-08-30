import * as anchor from "@coral-xyz/anchor";
import { Program, Wallet, AnchorProvider } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { Connection, PublicKey, Keypair, SystemProgram, Transaction, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

export const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Yg5pL");
export const PYTH_JITO_SOL_PRICE_FEED = new PublicKey("Gck2o8a2J4jPq3v2y4f4w7qJ8j8z5z5z5z5z5z5z5z"); // placeholder for sim

export interface PriceTick {
  price: number;
  slot: number;
  timestamp: number;
}

export function getJitoSolPrice(connection: Connection, priceFeed: PublicKey): Promise<number> {
  // For sim we return a mocked value; in real harness this would read Pyth
  return Promise.resolve(0.92); // default depeg sim value
}

export async function createTestVault(provider: AnchorProvider): Promise<{
  program: Program<Vault>;
  vault: PublicKey;
  buffer: PublicKey;
  owner: Keypair;
}> {
  const program = new Program<Vault>(
    require("../target/idl/vault.json"),
    provider
  );

  const owner = Keypair.generate();
  const vault = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.publicKey.toBuffer()],
    program.programId
  )[0];

  const buffer = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("buffer"), vault.toBuffer()],
    program.programId
  )[0];

  // Fund owner
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: provider.publicKey,
      toPubkey: owner.publicKey,
      lamports: 10 * anchor.web3.LAMPORTS_PER_SOL,
    })
  );
  await provider.sendAndConfirm(tx);

  return { program, vault, buffer, owner };
}

export async function setupJitoSolATA(
  connection: Connection,
  payer: Keypair,
  owner: PublicKey
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(JITO_SOL_MINT, owner);
  const accountInfo = await connection.getAccountInfo(ata);
  
  if (!accountInfo) {
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        ata,
        owner,
        JITO_SOL_MINT
      )
    );
    await anchor.web3.sendAndConfirmTransaction(connection, tx, [payer]);
  }
  
  return ata;
}

export function createLagInjector(
  basePrices: PriceTick[],
  lagSlots: number = 180 // ~45s at 4Hz
): (currentSlot: number) => number {
  return (currentSlot: number) => {
    const laggedSlot = Math.max(0, currentSlot - lagSlots);
    const tick = basePrices.find(t => t.slot >= laggedSlot) || basePrices[basePrices.length - 1];
    return tick.price;
  };
}

export async function advanceSlots(
  connection: Connection,
  slots: number
): Promise<number> {
  const currentSlot = await connection.getSlot();
  // In test validator we use clock manipulation via syscall or just wait
  for (let i = 0; i < slots; i++) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return currentSlot + slots;
}
