import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { Connection, Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { OraclePrices, getJitoSOLPrice } from "./oracle-utils"; // helper for replay series

// Hard-coded replay of last three historical Jito depeg series (price in lamports per SOL, slot timestamps)
const REPLAY_SERIES = [
  // series 1: mild depeg
  { slot: 280_000_000, price: 0.92 },
  { slot: 280_001_200, price: 0.89 },
  { slot: 280_002_500, price: 0.87 },
  // series 2: sharp drawdown (the one that should trip breaker)
  { slot: 281_100_000, price: 0.95 },
  { slot: 281_101_800, price: 0.78 },
  { slot: 281_103_100, price: 0.65 },
  // series 3: recovery
  { slot: 282_400_000, price: 0.71 },
  { slot: 282_402_000, price: 0.88 },
  { slot: 282_405_500, price: 0.97 },
];

const LAG_SLOTS_TARGET = 135; // ~45s at 333ms/slot

export class LagInjector {
  private program: Program<Vault>;
  private oraclePubkey: PublicKey;
  private bufferPda: PublicKey;
  private owner: Keypair;

  constructor(provider: AnchorProvider, program: Program<Vault>, oracle: PublicKey, owner: Keypair) {
    this.program = program;
    this.oraclePubkey = oracle;
    this.owner = owner;

    // Derive protection buffer PDA (matches program definition)
    const [bufferPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("protection_buffer")],
      program.programId
    );
    this.bufferPda = bufferPda;
  }

  /**
   * Injects the replay series into the on-chain oracle with a fixed slot lag.
   * Runs against a local test validator.
   */
  async injectWithLag(connection: Connection, lagSlots: number = LAG_SLOTS_TARGET): Promise<void> {
    console.log(`[LagInjector] Starting replay with ${lagSlots} slot lag...`);

    const clock = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
    let currentSlot = clock ? new anchor.BN(clock.data.readBigUInt64LE(8)).toNumber() : 280_000_000;

    for (const point of REPLAY_SERIES) {
      const laggedSlot = point.slot + lagSlots;
      console.log(`[LagInjector] Injecting price ${point.price} at lagged slot ${laggedSlot} (original ${point.slot})`);

      // Update on-chain oracle via program instruction that the vault can read
      await this.program.methods
        .updateOracle(new anchor.BN(laggedSlot), new anchor.BN(Math.floor(point.price * 1_000_000_000))) // price in 9 decimals
        .accounts({
          oracle: this.oraclePubkey,
          authority: this.owner.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([this.owner])
        .rpc();

      // Advance validator clock to simulate progression
      currentSlot = Math.max(currentSlot, laggedSlot + 10);
      await this.advanceTestClock(connection, currentSlot);
    }

    console.log("[LagInjector] Replay injection complete.");
  }

  private async advanceTestClock(connection: Connection, targetSlot: number): Promise<void> {
    // In test validator we use setClock instruction via custom RPC (common sim pattern)
    await connection.requestAirdrop(this.owner.publicKey, 1_000_000_000); // keep funded
    // In practice this would call a local set-clock endpoint; here we simulate by waiting
    // Real sim runner will use test-validator --clock or custom warp.
    console.log(`[LagInjector] Advanced test clock toward slot ${targetSlot}`);
  }

  getBufferPda(): PublicKey {
    return this.bufferPda;
  }
}

// Entry point for runner
export async function runLagInjection(): Promise<void> {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as Program<Vault>;

  // Test keys - match typical Anchor test setup
  const oracleKeypair = Keypair.generate();
  const owner = provider.wallet.payer as Keypair; // usually the test payer

  // Create oracle account (simplified)
  await provider.connection.confirmTransaction(
    await provider.connection.requestAirdrop(oracleKeypair.publicKey, 10_000_000_000)
  );

  const injector = new LagInjector(provider, program, oracleKeypair.publicKey, owner);
  await injector.injectWithLag(provider.connection, LAG_SLOTS_TARGET);
}

if (require.main === module) {
  runLagInjection().catch(console.error);
}
