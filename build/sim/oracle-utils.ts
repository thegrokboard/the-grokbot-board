import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection, SystemProgram } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";

export interface PriceData {
  price: anchor.BN;
  confidence: anchor.BN;
  timestamp: anchor.BN;
  slot: anchor.BN;
}

export const PRICE_ACCOUNT_SIZE = 8 + 32 + 8 + 8 + 8 + 8;

export async function createPriceAccount(
  connection: Connection,
  payer: anchor.Wallet,
  oracleProgramId: PublicKey
): Promise<PublicKey> {
  const priceAccount = Keypair.generate();
  const rent = await connection.getMinimumBalanceForRentExemption(PRICE_ACCOUNT_SIZE);

  const tx = new anchor.web3.Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: priceAccount.publicKey,
      space: PRICE_ACCOUNT_SIZE,
      lamports: rent,
      programId: oracleProgramId,
    })
  );

  await anchor.web3.sendAndConfirmTransaction(connection, tx, [payer.payer, priceAccount], {
    commitment: "confirmed",
  });

  return priceAccount.publicKey;
}

export async function updatePriceAccount(
  connection: Connection,
  payer: anchor.Wallet,
  priceAccount: PublicKey,
  oracleProgramId: PublicKey,
  price: number,
  confidence: number = 0.01,
  timestamp?: number
): Promise<void> {
  const slot = await connection.getSlot();
  const now = timestamp || Math.floor(Date.now() / 1000);

  const data = Buffer.alloc(PRICE_ACCOUNT_SIZE);
  data.writeBigUInt64LE(BigInt(price * 1_000_000), 40); // price
  data.writeBigUInt64LE(BigInt(confidence * 1_000_000), 48);
  data.writeBigUInt64LE(BigInt(now), 56);
  data.writeBigUInt64LE(BigInt(slot), 64);

  const tx = new anchor.web3.Transaction().add(
    new anchor.web3.TransactionInstruction({
      keys: [
        { pubkey: priceAccount, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      ],
      programId: oracleProgramId,
      data: Buffer.concat([Buffer.from([0]), data]),
    })
  );

  await anchor.web3.sendAndConfirmTransaction(connection, tx, [payer.payer], {
    commitment: "confirmed",
  });
}

export function createLagInjector(
  connection: Connection,
  payer: anchor.Wallet,
  oracleProgramId: PublicKey,
  lagSlots: number = 180 // ~45s at ~4 slots/sec
) {
  let priceAccount: PublicKey | null = null;
  let priceHistory: Array<{ price: number; slot: number; ts: number }> = [];

  return {
    async init(): Promise<PublicKey> {
      if (!priceAccount) {
        priceAccount = await createPriceAccount(connection, payer, oracleProgramId);
        // seed with initial price
        await updatePriceAccount(connection, payer, priceAccount, oracleProgramId, 1.0);
      }
      return priceAccount;
    },

    async injectLagPrice(currentPrice: number, currentSlot: number, currentTs: number) {
      if (!priceAccount) throw new Error("Injector not initialized");
      priceHistory.push({ price: currentPrice, slot: currentSlot, ts: currentTs });
      // replay lagged price from ~lagSlots ago
      const lagIdx = priceHistory.length - lagSlots - 1;
      const lagged = lagIdx >= 0 ? priceHistory[lagIdx] : priceHistory[0] || { price: currentPrice, slot: currentSlot, ts: currentTs };
      await updatePriceAccount(
        connection,
        payer,
        priceAccount,
        oracleProgramId,
        lagged.price,
        0.01,
        lagged.ts
      );
    },

    getPriceAccount(): PublicKey {
      if (!priceAccount) throw new Error("Injector not initialized");
      return priceAccount;
    },
  };
}

export async function checkTWAPFalsePositive(
  connection: Connection,
  vaultProgram: Program,
  priceAccount: PublicKey,
  jitoSolMint: PublicKey,
  expectedTWAP: number,
  toleranceBps: number = 50
): Promise<boolean> {
  // Fetch on-chain price and compute 15s TWAP
  const accountInfo = await connection.getAccountInfo(priceAccount);
  if (!accountInfo) return false;

  const data = accountInfo.data;
  const observedPrice = Number(data.readBigUInt64LE(40)) / 1_000_000;

  const isFalsePositive = Math.abs(observedPrice - expectedTWAP) * 10000 < toleranceBps;
  return isFalsePositive;
}
