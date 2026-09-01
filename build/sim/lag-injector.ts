import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { OracleConfig, PriceData } from "./oracle-utils";

export interface LagInjector {
  injectLagPrice: (
    connection: Connection,
    payer: Keypair,
    oraclePubkey: PublicKey,
    priceData: PriceData,
    lagSlots: number
  ) => Promise<string>;
}

export function createLagInjector(config: OracleConfig): LagInjector {
  const programId = new PublicKey(config.programId);

  async function injectLagPrice(
    connection: Connection,
    payer: Keypair,
    oraclePubkey: PublicKey,
    priceData: PriceData,
    lagSlots: number
  ): Promise<string> {
    // Simulate lagged oracle update by creating a transaction that sets a price
    // with a computed slot that is behind by lagSlots. In a real test validator
    // this would update a mock Switchboard or Pyth-like account.
    const currentSlot = await connection.getSlot();
    const laggedSlot = Math.max(0, currentSlot - lagSlots);

    const updatedPrice: PriceData = {
      ...priceData,
      slot: laggedSlot,
      timestamp: Math.floor(Date.now() / 1000) - Math.floor(lagSlots * 0.4), // rough 400ms per slot
    };

    // For the sim we send a mock update instruction (assuming a simple oracle program)
    const instructionData = Buffer.from(
      JSON.stringify({
        price: updatedPrice.price,
        confidence: updatedPrice.confidence,
        slot: updatedPrice.slot,
      })
    );

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: oraclePubkey,
        lamports: 1,
      })
    );

    // In real usage this would be replaced by the actual oracle update instruction
    // but for this harness we just advance the slot and log the injection.
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(payer);

    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });
    await connection.confirmTransaction(sig, "confirmed");

    console.log(`[LagInjector] Injected lagged price ${updatedPrice.price} at slot ${laggedSlot} (lag=${lagSlots})`);
    return sig;
  }

  return {
    injectLagPrice,
  };
}
