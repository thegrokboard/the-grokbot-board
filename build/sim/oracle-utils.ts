import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";

export interface PriceData {
  price: number;
  confidence: number;
  timestamp: number;
  slot: number;
}

export interface OracleConfig {
  programId: PublicKey;
  priceAccount: PublicKey;
  owner: Keypair;
}

export async function createPriceAccount(
  connection: Connection,
  payer: Keypair,
  owner: Keypair
): Promise<PublicKey> {
  const priceAccount = anchor.web3.Keypair.generate();
  const lamports = await connection.getMinimumBalanceForRentExemption(256);

  const tx = new anchor.web3.Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: priceAccount.publicKey,
      lamports,
      space: 256,
      programId: owner.publicKey, // placeholder; in real sim we use a pyth-like program
    })
  );

  await anchor.web3.sendAndConfirmTransaction(connection, tx, [payer, priceAccount]);
  return priceAccount.publicKey;
}

export async function updatePriceAccount(
  connection: Connection,
  priceAccount: PublicKey,
  data: PriceData,
  owner: Keypair,
  programId?: PublicKey
): Promise<void> {
  // In the pure-onchain test harness we write a simple account update.
  // Real Pyth would use its own CPI; here we just overwrite the buffer for simulation.
  const buffer = Buffer.alloc(256, 0);
  buffer.writeDoubleLE(data.price, 0);
  buffer.writeDoubleLE(data.confidence, 8);
  buffer.writeBigUInt64LE(BigInt(data.timestamp), 16);
  buffer.writeBigUInt64LE(BigInt(data.slot), 24);

  const tx = new anchor.web3.Transaction().add(
    anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    {
      keys: [
        { pubkey: priceAccount, isSigner: false, isWritable: true },
        { pubkey: owner.publicKey, isSigner: true, isWritable: false },
      ],
      programId: programId || new PublicKey("11111111111111111111111111111111"),
      data: buffer.slice(0, 32),
    }
  );

  await anchor.web3.sendAndConfirmTransaction(connection, tx, [owner]);
}

export function getLatestPrice(data: PriceData): number {
  return data.price;
}

export function createLagInjector(config: OracleConfig) {
  return {
    injectLagPrice: async (price: number, confidence: number, timestamp: number, lagSlots: number) => {
      const slot = await config.programId.connection?.getSlot() ?? 0; // fallback
      const laggedSlot = Math.max(0, slot - lagSlots);
      const priceData: PriceData = {
        price,
        confidence,
        timestamp: timestamp || Math.floor(Date.now() / 1000),
        slot: laggedSlot,
      };
      await updatePriceAccount(
        (config.programId as any).provider.connection,
        config.priceAccount,
        priceData,
        config.owner,
        config.programId as PublicKey
      );
    },
  };
}
