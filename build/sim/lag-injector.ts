import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import { createPriceAccount, updatePriceAccount } from "./oracle-utils";

export interface LagInjector {
  connection: Connection;
  program: Program<Vault>;
  oracle: PublicKey;
  lagSlots: number;
  priceHistory: Array<{ price: number; slot: number }>;
}

export async function createLagInjector(
  connection: Connection,
  wallet: Wallet,
  oracleProgramId: PublicKey = new PublicKey("11111111111111111111111111111111"),
  lagSeconds: number = 45
): Promise<LagInjector> {
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as Program<Vault>;
  const lagSlots = Math.floor((lagSeconds * 2)); // rough 2 slots per second on test validator

  // Create a mock oracle account for the simulation
  const oracleKeypair = Keypair.generate();
  await createPriceAccount(connection, wallet, oracleKeypair, oracleProgramId);

  return {
    connection,
    program,
    oracle: oracleKeypair.publicKey,
    lagSlots,
    priceHistory: [],
  };
}

export async function injectLagPrice(
  injector: LagInjector,
  price: number,
  currentSlot: number,
  payer: Keypair
): Promise<void> {
  // Record the real-time price
  injector.priceHistory.push({ price, slot: currentSlot });

  // Find the lagged price (45s ago)
  const targetSlot = currentSlot - injector.lagSlots;
  let laggedPrice = price; // fallback to current if no history

  for (let i = injector.priceHistory.length - 1; i >= 0; i--) {
    if (injector.priceHistory[i].slot <= targetSlot) {
      laggedPrice = injector.priceHistory[i].price;
      break;
    }
  }

  // Update the on-chain oracle with the lagged price
  await updatePriceAccount(
    injector.connection,
    payer,
    injector.oracle,
    laggedPrice,
    currentSlot
  );

  // Trim old history to keep memory reasonable
  if (injector.priceHistory.length > 1000) {
    injector.priceHistory = injector.priceHistory.slice(-500);
  }
}
