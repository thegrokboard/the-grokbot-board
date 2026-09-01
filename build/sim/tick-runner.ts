import * as anchor from "@coral-xyz/anchor";
import { Program, Wallet, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import { createLagInjector, injectLagPrice } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createPriceAccount, updatePriceAccount, PriceData } from "./oracle-utils";

const RPC_URL = "http://127.0.0.1:8899";
const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTq2x2mXgX2bJ7bQ2dK4v3p2q"); // placeholder for sim
const PYTH_ORACLE = new PublicKey("8o8z5z7z8z9z0z1z2z3z4z5z6z7z8z9z0z1z2z3z4z"); // placeholder

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const payer = Keypair.generate();
  await connection.requestAirdrop(payer.publicKey, 10_000_000_000);
  
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as Program<Vault>;

  // Setup price account
  const priceAccount = await createPriceAccount(provider, PYTH_ORACLE, payer);

  const injector = createLagInjector(connection, PYTH_ORACLE, priceAccount, 45);

  // Replay last three Jito depeg series (simplified synthetic data)
  const series: PriceData[] = [
    { price: 0.92, confidence: 0.01, timestamp: Date.now() / 1000, slot: 100 },
    { price: 0.88, confidence: 0.02, timestamp: Date.now() / 1000 + 5, slot: 105 },
    { price: 0.85, confidence: 0.015, timestamp: Date.now() / 1000 + 10, slot: 110 },
  ];

  console.log("Starting 7-day tick sim (compressed to seconds for test)...");

  let breakerTrips = 0;
  let falsePositives = 0;
  const TICKS = 30; // simulate 30 ticks for test run

  for (let i = 0; i < TICKS; i++) {
    const tickSlot = 100 + i * 4;
    const pricePoint = series[i % series.length];

    await injectLagPrice(injector, pricePoint.price, pricePoint.confidence, tickSlot);

    const currentPrice = await injector.getCurrentPrice();
    const isFalsePositive = checkTWAPFalsePositive(series, currentPrice);

    if (isFalsePositive) {
      falsePositives++;
      console.log(`Tick ${i}: FALSE POSITIVE at price ${currentPrice}`);
    } else if (currentPrice < 0.90) {
      breakerTrips++;
      console.log(`Tick ${i}: BREAKER TRIPPED at price ${currentPrice}`);
      
      // Simulate drawdown circuit-breaker instruction
      const tx = await program.methods
        .triggerCircuitBreaker()
        .accounts({
          owner: payer.publicKey,
          vault: PublicKey.findProgramAddressSync([Buffer.from("vault")], program.programId)[0],
          priceFeed: priceAccount,
        })
        .signers([payer])
        .rpc();
      console.log("Circuit breaker tx:", tx);
    }
  }

  console.log("\nSimulation complete");
  console.log(`Breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / TICKS) * 100).toFixed(1)}%`);
}

main().catch(console.error);
