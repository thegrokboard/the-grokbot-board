import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import { createLagInjector, injectLagPrice } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createPriceAccount, updatePriceAccount, PriceData } from "./oracle-utils";
import fs from "fs";

// 7-day simulation constants (in slots, ~400ms per slot)
const SLOTS_PER_SECOND = 2.5;
const SIM_DURATION_SLOTS = 7 * 24 * 60 * 60 * SLOTS_PER_SECOND; // ~1.5M slots
const LAG_TARGET_SLOTS = Math.floor(45 * SLOTS_PER_SECOND); // 45s lag
const TWAP_WINDOW_SLOTS = Math.floor(15 * SLOTS_PER_SECOND);
const TICK_INTERVAL_SLOTS = 10; // simulate every 4s

// Sample JitoSOL depeg price series (price in USD * 1e9, last three known depeg events simplified)
const PRICE_SERIES: PriceData[] = [
  { price: 0.98 * 1e9, confidence: 0.02 * 1e9, timestamp: 0 },
  { price: 0.95 * 1e9, confidence: 0.03 * 1e9, timestamp: 5 },
  { price: 0.92 * 1e9, confidence: 0.04 * 1e9, timestamp: 12 },
  { price: 0.89 * 1e9, confidence: 0.05 * 1e9, timestamp: 20 },
  { price: 0.87 * 1e9, confidence: 0.06 * 1e9, timestamp: 35 },
  { price: 0.85 * 1e9, confidence: 0.07 * 1e9, timestamp: 60 },
  { price: 0.90 * 1e9, confidence: 0.04 * 1e9, timestamp: 90 },
  { price: 0.96 * 1e9, confidence: 0.02 * 1e9, timestamp: 130 },
  { price: 0.99 * 1e9, confidence: 0.01 * 1e9, timestamp: 200 },
];

async function main() {
  // Setup provider and program
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Vault as Program<Vault>;
  const payer = (provider.wallet as Wallet).payer;

  console.log("Starting pure-onchain Anchor JitoSOL vault depeg sim...");

  // Create oracle price account
  const oracleKeypair = Keypair.generate();
  await createPriceAccount(provider.connection, payer, oracleKeypair, program.programId);
  const oraclePubkey = oracleKeypair.publicKey;

  // Initialize vault
  const vaultKeypair = Keypair.generate();
  const [protectionBuffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("protection_buffer"), vaultKeypair.publicKey.toBuffer()],
    program.programId
  );

  await program.methods
    .initialize(new anchor.BN(0.85 * 1e9)) // drawdown threshold 15%
    .accounts({
      vault: vaultKeypair.publicKey,
      owner: payer.publicKey,
      oracle: oraclePubkey,
      protectionBuffer,
      systemProgram: SystemProgram.programId,
    })
    .signers([vaultKeypair])
    .rpc();

  console.log(`Vault initialized: ${vaultKeypair.publicKey.toBase58()}`);

  // Create lag injector
  const injector = createLagInjector(PRICE_SERIES, LAG_TARGET_SLOTS);

  let currentSlot = 0;
  let breakerTrips = 0;
  let falsePositives = 0;
  let lastPrices: PriceData[] = [];

  console.log("Running 7-day tick simulation...");

  while (currentSlot < SIM_DURATION_SLOTS) {
    // Inject lagged price at current slot
    const injected = injectLagPrice(injector, currentSlot, oraclePubkey, payer);
    if (injected) {
      const priceData = PRICE_SERIES[Math.floor(Math.random() * PRICE_SERIES.length)];
      await updatePriceAccount(
        provider.connection,
        payer,
        oraclePubkey,
        priceData.price,
        priceData.confidence,
        currentSlot
      );
      lastPrices.push({ ...priceData, timestamp: currentSlot });
      if (lastPrices.length > 50) lastPrices.shift(); // keep bounded history
    }

    // Every TWAP_WINDOW_SLOTS, run false-positive checker against onchain state
    if (currentSlot % TWAP_WINDOW_SLOTS === 0 && lastPrices.length >= 3) {
      const isFalsePositive = checkTWAPFalsePositive(
        lastPrices,
        TWAP_WINDOW_SLOTS,
        0.85 * 1e9 // drawdown threshold
      );
      if (isFalsePositive) {
        falsePositives++;
        console.log(`[${currentSlot}] TWAP false positive detected`);
      }
    }

    // Tick vault onchain (simulate drawdown circuit breaker check)
    try {
      await program.methods
        .checkDrawdown()
        .accounts({
          vault: vaultKeypair.publicKey,
          oracle: oraclePubkey,
          owner: payer.publicKey,
        })
        .rpc();
    } catch (err: any) {
      if (err.toString().includes("DrawdownBreached")) {
        breakerTrips++;
        console.log(`[${currentSlot}] CIRCUIT BREAKER TRIPPED`);
      }
    }

    currentSlot += TICK_INTERVAL_SLOTS;
  }

  console.log("\n=== Simulation Complete ===");
  console.log(`Total breaker trips: ${breakerTrips}`);
  console.log(`False positives detected: ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / Math.max(breakerTrips, 1)) * 100).toFixed(1)}%`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
