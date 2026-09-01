import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { createLagInjector, injectLagPrice } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createPriceAccount, updatePriceAccount, PriceData } from "./oracle-utils";
import { Vault } from "../target/types/vault";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as anchor.Program<Vault>;
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const oracleKeypair = Keypair.generate();
  const vaultKeypair = Keypair.generate();
  const jitoSolMint = new PublicKey("J1toso1uCk3RLmP4n7Y5mL7o1K9z7z4r5v6n7m8o9p0"); // placeholder for JitoSOL mint
  const protectionBuffer = Keypair.generate();

  // Create price account (oracle)
  await createPriceAccount(connection, payer, oracleKeypair);

  // Initialize vault (simplified for test harness)
  await program.methods
    .initialize(new anchor.BN(1000)) // example buffer size in lamports
    .accounts({
      vault: vaultKeypair.publicKey,
      owner: payer.publicKey,
      jitoSolMint: jitoSolMint,
      protectionBuffer: protectionBuffer.publicKey,
      oracle: oracleKeypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([vaultKeypair, protectionBuffer])
    .rpc();

  // Load historical price series (last three Jito depeg events - stub data for sim)
  const priceHistory: PriceData[] = [
    { price: 0.95, confidence: 0.01, timestamp: Date.now() - 100000, slot: 100 },
    { price: 0.92, confidence: 0.02, timestamp: Date.now() - 90000, slot: 150 },
    { price: 0.88, confidence: 0.03, timestamp: Date.now() - 80000, slot: 200 },
    { price: 0.85, confidence: 0.05, timestamp: Date.now() - 70000, slot: 250 },
    { price: 0.90, confidence: 0.02, timestamp: Date.now() - 60000, slot: 300 },
  ];

  const lagInjector = createLagInjector(45); // target 45s lag

  console.log("Starting 7-day tick simulation (replayed over ~15s for testing)...");

  let breakerTrips = 0;
  let falsePositives = 0;
  let tick = 0;
  const maxTicks = 50; // simulate ~7 days compressed into ticks

  while (tick < maxTicks) {
    // Inject lagged price
    const currentData = priceHistory[tick % priceHistory.length];
    await injectLagPrice(
      connection,
      oracleKeypair.publicKey,
      payer,
      currentData.price,
      currentData.confidence,
      lagInjector
    );

    // Run 15s TWAP false-positive checker
    const isFalsePositive = checkTWAPFalsePositive(priceHistory.slice(0, tick + 1));
    if (isFalsePositive) {
      falsePositives++;
    }

    // Check for drawdown circuit breaker (simplified on-chain call)
    try {
      await program.methods
        .checkDrawdown()
        .accounts({
          vault: vaultKeypair.publicKey,
          oracle: oracleKeypair.publicKey,
          owner: payer.publicKey,
        })
        .rpc();
    } catch (e: any) {
      if (e.toString().includes("DrawdownBreached")) {
        breakerTrips++;
        console.log(`Circuit breaker tripped at tick ${tick}`);
      }
    }

    tick++;
    // Simulate time passage
    await new Promise((resolve) => setTimeout(resolve, 300)); // ~15s compressed sim
  }

  console.log("Simulation complete.");
  console.log(`Breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log("Ratio of false positives to trips:", falsePositives / (breakerTrips || 1));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
