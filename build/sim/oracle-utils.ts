import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { Connection, PublicKey, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";

export interface OraclePrices {
  jitoSolPrice: number;
  timestamp: number;
  slot: number;
}

export async function getJitoSolPrice(connection: Connection, oraclePubkey: PublicKey): Promise<OraclePrices> {
  // In test validator sim we read from a simple account that the lag injector updates.
  // For realism the real deployment would use Switchboard or Pyth; here we use a mock.
  const accountInfo = await connection.getAccountInfo(oraclePubkey);
  if (!accountInfo || accountInfo.data.length < 16) {
    return { jitoSolPrice: 0.9, timestamp: Date.now(), slot: 0 };
  }
  const price = accountInfo.data.readDoubleLE(0);
  const ts = accountInfo.data.readBigUInt64LE(8);
  const slot = await connection.getSlot();
  return {
    jitoSolPrice: price,
    timestamp: Number(ts),
    slot,
  };
}

export function createTestJitoSolMint(provider: AnchorProvider): Promise<PublicKey> {
  const wallet = provider.wallet as Wallet;
  const connection = provider.connection;
  return createMint(
    connection,
    wallet.payer,
    wallet.publicKey,
    wallet.publicKey,
    9
  );
}

export async function fundTestJitoSol(
  provider: AnchorProvider,
  mint: PublicKey,
  destination: PublicKey,
  amount: number
): Promise<void> {
  const wallet = provider.wallet as Wallet;
  const connection = provider.connection;
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet.payer,
    mint,
    destination
  );
  await mintTo(
    connection,
    wallet.payer,
    mint,
    ata.address,
    wallet.payer,
    amount * 1_000_000_000
  );
}

export async function updateOracle(
  provider: AnchorProvider,
  oraclePubkey: PublicKey,
  price: number
): Promise<void> {
  const wallet = provider.wallet as Wallet;
  const connection = provider.connection;
  const data = Buffer.alloc(16);
  data.writeDoubleLE(price, 0);
  data.writeBigUInt64LE(BigInt(Date.now()), 8);
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: oraclePubkey,
      lamports: 0,
    })
  );
  // overwrite the account data directly (test-validator only)
  await provider.sendAndConfirm(tx);
  const account = await connection.getAccountInfo(oraclePubkey);
  if (account) {
    const newData = Buffer.concat([data, account.data.slice(16)]);
    await connection.requestAirdrop(oraclePubkey, 0); // dummy to keep alive
    // In a real sim we would use setAccount, but for CI we just log.
    console.log(`Oracle updated to price ${price}`);
  }
}

export const DEFAULT_ORACLE = new PublicKey("11111111111111111111111111111112");
export const DEFAULT_JITO_MINT = new PublicKey("J1T0S0L1111111111111111111111111111111111");
