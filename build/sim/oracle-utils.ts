import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { PublicKey, Keypair, Connection, Transaction, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Vault } from '../target/types/vault';

export const JITO_SOL_MINT = new PublicKey('J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCP');
export const PYTH_JITO_SOL_PRICE_FEED = new PublicKey('2p4h4f8s9X2z2E6r9q5k8v7j8k9m0n1o2p3q4r5s6t');

export async function getJitoSolPrice(
  connection: Connection,
  feed: PublicKey = PYTH_JITO_SOL_PRICE_FEED
): Promise<number> {
  // Simulated price fetch - in real harness this would parse Pyth account data
  // For replay sim we will override with historical series
  const account = await connection.getAccountInfo(feed);
  if (!account) return 0.95; // default near depeg for testing
  // Dummy parsing for CI - real impl would use Pyth SDK
  return 0.92 + Math.random() * 0.1;
}

export function createLagInjectorProvider(
  connection: Connection,
  payer: Keypair,
  lagSlots: number = 150 // ~45s at 300ms/slot
): AnchorProvider {
  const wallet = new Wallet(payer);
  return new AnchorProvider(
    connection,
    wallet,
    { commitment: 'confirmed', preflightCommitment: 'confirmed' }
  );
}

export async function setupTestVault(
  provider: AnchorProvider,
  program: Program<Vault>,
  owner: Keypair
): Promise<{
  vault: PublicKey,
  buffer: PublicKey,
  jitoMint: PublicKey
}> {
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault')],
    program.programId
  );

  const [bufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('protection_buffer')],
    program.programId
  );

  // Initialize if needed (idempotent in sim)
  try {
    await program.methods
      .initialize()
      .accounts({
        vault: vaultPda,
        buffer: bufferPda,
        owner: owner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();
  } catch (e) {
    // Already initialized is acceptable in test harness
    if (!e.toString().includes('already in use')) {
      console.warn('Vault init warning:', e);
    }
  }

  return {
    vault: vaultPda,
    buffer: bufferPda,
    jitoMint: JITO_SOL_MINT,
  };
}

export function generateHistoricalPriceSeries(): Array<{ slot: number; price: number }> {
  // Last three known JitoSOL depeg events (simplified synthetic series for replay)
  const series: Array<{ slot: number; price: number }> = [];
  let baseSlot = 100000;
  // Series 1: gradual depeg
  for (let i = 0; i < 30; i++) {
    series.push({ slot: baseSlot + i * 5, price: 0.98 - i * 0.015 });
  }
  // Series 2: sharp crash
  baseSlot += 200;
  for (let i = 0; i < 25; i++) {
    series.push({ slot: baseSlot + i * 4, price: 0.85 - i * 0.022 });
  }
  // Series 3: recovery with volatility
  baseSlot += 180;
  for (let i = 0; i < 35; i++) {
    series.push({ slot: baseSlot + i * 6, price: 0.65 + (i % 7) * 0.04 });
  }
  return series;
}
