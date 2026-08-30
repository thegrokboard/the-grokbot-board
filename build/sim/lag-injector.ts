import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { readFileSync } from "fs";

// Hard-coded replay of the last three Jito depeg price series (slot, price in lamports)
const REPLAY_SERIES = [
  // series 1 - mild depeg
  [
    { slot: 1000, price: 0.98e9 },
    { slot: 1010, price: 0.95e9 },
    { slot: 1025, price: 0.92e9 },
  ],
  // series 2 - sharp drawdown
  [
    { slot: 2000, price: 0.99e9 },
    { slot: 2015, price: 0.85e9 },
    { slot: 2030, price: 0.78e9 },
  ],
  // series 3 - recovery after depeg
  [
    { slot: 3000, price: 0.80e9 },
    { slot: 3020, price: 0.88e9 },
    { slot: 3050, price: 0.97e9 },
  ],
];

async function main() {
  // Use local test validator
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");

  // Load the payer from the default Anchor keypair (for test validator)
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync("target/deploy/vault-keypair.json", "utf-8")))
  );

  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);

  const programId = new PublicKey("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"); // placeholder - updated by anchor build
  const program = new Program<Vault>(programId, provider);

  console.log("Lag injector started. Replaying 3 JitoSOL depeg series with configurable oracle lag...");

  const oracleLagSlots = 90; // ~45s at 400ms/slot target
  const bufferPda = PublicKey.findProgramAddressSync(
    [Buffer.from("buffer")],
    program.programId
  )[0];

  for (let seriesIdx = 0; seriesIdx < REPLAY_SERIES.length; seriesIdx++) {
    console.log(`\n=== Replaying series ${seriesIdx + 1} with ${oracleLagSlots} slot lag ===`);

    for (const tick of REPLAY_SERIES[seriesIdx]) {
      const laggedSlot = tick.slot + oracleLagSlots;

      // Simulate feeding price via the drawdown circuit-breaker instruction
      try {
        const tx = await program.methods
          .checkDrawdown(new anchor.BN(tick.price), new anchor.BN(laggedSlot))
          .accounts({
            buffer: bufferPda,
            owner: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        console.log(`  slot ${tick.slot} (lagged ${laggedSlot}) price ${tick.price / 1e9} -> tx ${tx.slice(0, 8)}...`);
      } catch (err: any) {
        console.log(`  slot ${tick.slot} (lagged ${laggedSlot}) price ${tick.price / 1e9} -> breaker trip or error: ${err.message}`);
      }

      // Sleep to simulate real-time passage in sim
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  console.log("\nLag injector replay completed. Check tick-runner.ts / twap-checker.ts for breaker vs false-positive stats.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
