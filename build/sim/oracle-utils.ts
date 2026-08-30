import * as anchor from "@coral-xyz/anchor";
import { Program, Wallet, AnchorProvider } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { Connection, PublicKey, Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCP");
export const PYTH_ORACLE_PROGRAM = new PublicKey("FsJ3A3u2vn5cTVofAjvy6y5kwAB41t7b4Uq1bK7b5b5j");
export const JITO_SOL_PRICE_FEED = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCP"); // placeholder for real feed in sim

export interface PriceSeries {
  slot: number;
  price: number; // scaled to 1e9
  confidence: number;
}

export function getJitoSolPrice(series: PriceSeries[], slot: number): number | null {
  const entry = series.find(s => s.slot === slot);
  return entry ? entry.price : null;
}

export async function createTestOracle(
  provider: AnchorProvider,
  initialPrice: number
): Promise<PublicKey> {
  const oracleKeypair = Keypair.generate();
  const lamports = await provider.connection.getMinimumBalanceForRentExemption(1024);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: provider.publicKey,
      newAccountPubkey: oracleKeypair.publicKey,
      lamports,
      space: 1024,
      programId: PYTH_ORACLE_PROGRAM,
    })
  );

  await provider.sendAndConfirm(tx, [oracleKeypair]);
  return oracleKeypair.publicKey;
}

export async function updateOraclePrice(
  provider: AnchorProvider,
  oracle: PublicKey,
  price: number,
  slot: number
): Promise<void> {
  // In real sim we would CPI to Pyth, here we just log for test-validator replay
  console.log(`[oracle-utils] Simulated oracle update at slot ${slot}: $${price / 1e9}`);
  // No-op for local test validator; lag-injector will drive real account data
}

export function createLagProvider(
  connection: Connection,
  wallet: Wallet,
  lagSlots: number = 90 // ~45s at 500ms/slot
): AnchorProvider {
  const payer = (wallet as any).payer || (wallet as any).secretKey 
    ? wallet 
    : (wallet as any).wallet;

  return new AnchorProvider(
    connection,
    wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
}

// Vault PDA helpers matching the on-chain program
export function getVaultAuthority(vaultProgramId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("authority")],
    vaultProgramId
  );
}

export function getProtectionBuffer(vaultProgramId: PublicKey, owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("buffer"), owner.toBuffer()],
    vaultProgramId
  );
}

export function getDrawdownAccount(vaultProgramId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("drawdown")],
    vaultProgramId
  );
}
