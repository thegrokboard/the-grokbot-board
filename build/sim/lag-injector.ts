import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import fs from "fs";

// Hard-coded replay of last three historical JitoSOL depeg price series (simplified for test harness)
// Each entry: { slot: number, price: number } - price in lamports per JitoSOL (approx)
const PRICE_SERIES = [
  // Series 1: mild depeg
  [
    { slot: 100, price: 0.98 },
    { slot: 110, price: 0.95 },
    { slot: 120, price: 0.92 },
    { slot: 130, price: 0.89 },
  ],
  // Series 2: sharp depeg
  [
    { slot: 200, price: 0.99 },
    { slot: 205, price: 0.85 },
    { slot: 210, price: 0.78 },
    { slot: 215, price: 0.71 },
  ],
  // Series 3: recovery after depeg
  [
    { slot: 300, price: 0.75 },
    { slot: 310, price: 0.82 },
    { slot: 320, price: 0.91 },
    { slot: 330, price: 0.97 },
  ],
];

const ORACLE_LAG_SLOTS = 90; // ~45s at 0.5s/slot target

export async function runLagInjector(
  provider: AnchorProvider,
  vaultProgram: Program<Vault>,
  oraclePubkey: PublicKey,
  owner: Keypair
): Promise<void> {
  console.log("Starting lag injector replay with", ORACLE_LAG_SLOTS, "slot lag...");

  const connection = provider.connection;
  let currentSlot = await connection.getSlot();

  for (const series of PRICE_SERIES) {
    for (const tick of series) {
      const targetSlot = tick.slot + ORACLE_LAG_SLOTS;
      // Wait until we reach the lagged slot (sim harness runs against test validator)
      while (true) {
        currentSlot = await connection.getSlot();
        if (currentSlot >= targetSlot) break;
        await new Promise((r) => setTimeout(r, 50));
      }

      // Simulate oracle update by calling the vault's update_price instruction (assumed in program)
      const tx = await vaultProgram.methods
        .updateOraclePrice(new anchor.BN(Math.floor(tick.price * 1_000_000_000))) // price as u64 scaled
        .accounts({
          oracle: oraclePubkey,
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();

      console.log(`Injected lagged price ${tick.price} at slot ${currentSlot} (orig ${tick.slot}) tx=${tx}`);
    }
  }

  console.log("Lag injector replay completed.");
}

// For direct CLI usage
if (require.main === module) {
  (async () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Vault as Program<Vault>;

    // Load or generate test owner and oracle
    let owner: Keypair;
    const ownerPath = "target/owner.json";
    if (fs.existsSync(ownerPath)) {
      owner = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(ownerPath, "utf-8")))
      );
    } else {
      owner = Keypair.generate();
      fs.writeFileSync(ownerPath, JSON.stringify(Array.from(owner.secretKey)));
    }

    // In test harness the oracle is typically a PDA or configured account
    const [oraclePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle")],
      program.programId
    );

    await runLagInjector(provider, program, oraclePda, owner);
  })().catch(console.error);
}
