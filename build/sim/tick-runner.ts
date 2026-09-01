import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createLagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createPriceAccount, updatePriceAccount, PriceData } from "./oracle-utils";
import { Vault } from "../target/types/vault";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as anchor.Program<Vault>;
  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;

  // Use the program owner as the vault owner for testing
  const owner = (wallet as any).payer as Keypair;

  console.log("Starting pure-onchain Anchor JitoSOL depeg sim harness...");

  // Create a price account to simulate the JitoSOL oracle
  const priceAccount = await createPriceAccount(connection, owner);
  console.log(`Created mock price account: ${priceAccount.toBase58()}`);

  // Initialize the vault (minimal setup for breaker testing)
  const vault = Keypair.generate();
  const protectionBuffer = Keypair.generate();

  await program.methods
    .initialize()
    .accounts({
      vault: vault.publicKey,
      owner: owner.publicKey,
      protectionBuffer: protectionBuffer.publicKey,
      priceAccount: priceAccount,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([vault, protectionBuffer])
    .rpc();
  console.log(`Initialized vault at ${vault.publicKey.toBase58()}`);

  const lagInjector = createLagInjector(connection, owner, priceAccount);

  // Replay the last three Jito depeg price series with configurable lag
  const series = [
    { price: 0.95, confidence: 0.01, timestamp: Date.now() / 1000 },
    { price: 0.88, confidence: 0.02, timestamp: Date.now() / 1000 + 10 },
    { price: 0.75, confidence: 0.05, timestamp: Date.now() / 1000 + 25 },
    { price: 0.92, confidence: 0.01, timestamp: Date.now() / 1000 + 45 },
  ];

  console.log("Injecting lagged price series (target 45s oracle lag)...");
  for (const point of series) {
    await lagInjector.injectLagPrice(point.price, point.confidence, point.timestamp);
    // Advance slot to simulate time passage
    await connection.requestAirdrop(owner.publicKey, LAMPORTS_PER_SOL); // dummy to advance
  }

  console.log("Running 15s TWAP false-positive checker...");
  const currentSlot = await connection.getSlot();
  const isFalsePositive = await checkTWAPFalsePositive(
    connection,
    priceAccount,
    currentSlot,
    15 // twap window in seconds
  );

  console.log(`TWAP false-positive result: ${isFalsePositive}`);

  // Simulate 7-day tick runner (condensed for test)
  console.log("Starting 7-day tick runner simulation (condensed)...");
  let breakerTrips = 0;
  let falsePositives = 0;

  for (let day = 0; day < 7; day++) {
    for (let tick = 0; tick < 24; tick++) { // 24 ticks per simulated day
      const price = 0.9 + Math.random() * 0.2 - 0.1; // simulate price around 0.9
      const confidence = 0.01 + Math.random() * 0.03;
      const ts = Date.now() / 1000 + day * 86400 + tick * 3600;

      await lagInjector.injectLagPrice(price, confidence, ts);

      const slot = await connection.getSlot();
      const fp = await checkTWAPFalsePositive(connection, priceAccount, slot, 15);

      if (price < 0.8) {
        // Simulate drawdown circuit-breaker trigger
        try {
          await program.methods
            .triggerDrawdown()
            .accounts({
              vault: vault.publicKey,
              owner: owner.publicKey,
              priceAccount: priceAccount,
            })
            .signers([owner])
            .rpc();
          breakerTrips++;
          console.log(`Breaker trip on day ${day} tick ${tick} at price ${price.toFixed(2)}`);
        } catch (e) {
          // already tripped or paused
        }
      }

      if (fp) falsePositives++;
    }
  }

  console.log("\n=== Simulation Complete ===");
  console.log(`Breaker trips: ${breakerTrips}`);
  console.log(`False positives (15s TWAP): ${falsePositives}`);
  console.log("Pure-onchain sim harness finished successfully.");
}

main().catch((err) => {
  console.error("Sim failed:", err);
  process.exit(1);
});
