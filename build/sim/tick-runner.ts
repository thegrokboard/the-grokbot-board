import * as anchor from "@coral-xyz/anchor";
import { Program, Wallet, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import { createLagInjector, injectLagPrice } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createPriceAccount, updatePriceAccount, PriceData } from "./oracle-utils";

const RPC_URL = "http://127.0.0.1:8899";
const connection = new Connection(RPC_URL, "confirmed");

async function main() {
  const payer = Keypair.generate();
  const wallet = new Wallet(payer);

  const provider = new AnchorProvider(
    connection,
    wallet,
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as Program<Vault>;

  // Airdrop to payer
  const airdropSig = await connection.requestAirdrop(payer.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdropSig);

  console.log("Setting up simulation accounts...");
  const oraclePubkey = await createPriceAccount(provider, payer);
  const vault = Keypair.generate();
  const buffer = Keypair.generate();

  // Initialize the vault (owner = payer)
  await program.methods
    .initialize(new anchor.BN(45000)) // 45s target lag in slots (approx)
    .accounts({
      vault: vault.publicKey,
      owner: payer.publicKey,
      buffer: buffer.publicKey,
      oracle: oraclePubkey,
      systemProgram: SystemProgram.programId,
    })
    .signers([vault, buffer])
    .rpc();

  console.log("Vault initialized. Starting 7-day tick simulation...");

  const lagInjector = createLagInjector(connection, provider, oraclePubkey, payer, 45);

  // Replay last three Jito depeg price series (simplified synthetic data for test)
  const priceSeries: PriceData[] = [
    { price: 0.98, confidence: 0.01, timestamp: Date.now() / 1000 },
    { price: 0.85, confidence: 0.02, timestamp: Date.now() / 1000 + 30 },
    { price: 0.72, confidence: 0.05, timestamp: Date.now() / 1000 + 90 },
    { price: 0.95, confidence: 0.01, timestamp: Date.now() / 1000 + 150 },
    { price: 0.99, confidence: 0.005, timestamp: Date.now() / 1000 + 300 },
  ];

  let breakerTrips = 0;
  let falsePositives = 0;
  const totalTicks = 7 * 24 * 60 * 4; // ~7 days at 15s ticks

  for (let tick = 0; tick < totalTicks; tick++) {
    const idx = tick % priceSeries.length;
    const pricePoint = priceSeries[idx];

    await injectLagPrice(lagInjector, pricePoint.price, pricePoint.confidence);

    // Update on-chain oracle
    await updatePriceAccount(provider, payer, oraclePubkey, pricePoint.price, pricePoint.confidence);

    // Run TWAP false-positive checker (15s window)
    const isFalsePositive = await checkTWAPFalsePositive(
      connection,
      oraclePubkey,
      new anchor.BN(pricePoint.price * 1e9),
      new anchor.BN(15)
    );

    if (isFalsePositive) {
      falsePositives++;
      console.log(`Tick ${tick}: False positive detected`);
    }

    // Check for breaker trip via on-chain drawdown circuit-breaker
    try {
      await program.methods
        .checkDrawdown()
        .accounts({
          vault: vault.publicKey,
          oracle: oraclePubkey,
          buffer: buffer.publicKey,
        })
        .rpc();
    } catch (e: any) {
      if (e.toString().includes("DrawdownBreached")) {
        breakerTrips++;
        console.log(`Tick ${tick}: Circuit breaker tripped!`);
      }
    }

    // Simulate 15s tick delay
    await new Promise((resolve) => setTimeout(resolve, 15));
  }

  console.log("\nSimulation complete.");
  console.log(`Breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / totalTicks) * 100).toFixed(2)}%`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
