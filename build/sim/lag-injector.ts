import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import { loadJitoDepegSeries } from "./oracle-utils";

export interface LagInjector {
  injectLagPrice: (lagSlots: number) => Promise<void>;
  close: () => Promise<void>;
}

export async function createLagInjector(
  provider: AnchorProvider,
  vaultProgram: Program<Vault>,
  oraclePubkey: PublicKey,
  priceFeedPubkey: PublicKey
): Promise<LagInjector> {
  const connection = provider.connection;
  const wallet = provider.wallet as Wallet;

  // Load the historical Jito depeg price series (timestamp, price)
  const priceSeries = await loadJitoDepegSeries();

  let currentIndex = 0;
  let lastSlot = 0;

  const injectLagPrice = async (lagSlots: number = 180): Promise<void> => {
    if (currentIndex >= priceSeries.length) {
      currentIndex = 0; // loop for repeated sim runs
    }

    const entry = priceSeries[currentIndex];
    const now = Math.floor(Date.now() / 1000);
    const laggedTimestamp = now - (lagSlots * 0.4); // ~400ms per slot approx

    // Create a synthetic oracle update transaction that mimics a lagged Switchboard or Pyth update
    // In a real test-validator sim we update an account that the vault reads as its oracle
    const updateIx = await vaultProgram.methods
      .updateOracle(new anchor.BN(laggedTimestamp), new anchor.BN(Math.floor(entry.price * 1e9)))
      .accounts({
        oracle: oraclePubkey,
        authority: wallet.publicKey,
        priceFeed: priceFeedPubkey,
      })
      .instruction();

    const tx = new Transaction().add(updateIx);
    const latestBlockhash = await connection.getLatestBlockhash();
    tx.recentBlockhash = latestBlockhash.blockhash;
    tx.feePayer = wallet.publicKey;

    await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });

    // Advance validator slots to simulate exact lag
    await advanceSlots(connection, lagSlots);

    currentIndex++;
    lastSlot = (await connection.getSlot("confirmed")) + lagSlots;
  };

  const close = async (): Promise<void> => {
    // cleanup if needed (none for this sim)
  };

  return {
    injectLagPrice,
    close,
  };
}

async function advanceSlots(connection: Connection, slots: number): Promise<void> {
  // Test validator slot advancement via sysvar or repeated empty tx (common sim pattern)
  for (let i = 0; i < slots; i += 8) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: PublicKey.default,
        toPubkey: PublicKey.default,
        lamports: 0,
      })
    );
    try {
      await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    } catch (e) {
      // expected in sim
    }
  }
  // Force slot progression in test validator
  await connection.getSlot("confirmed");
}
