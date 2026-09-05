import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import { LagInjector, LagInjectorConfig } from "./lag-injector";
import { getHistoricalJitoPrices, HistoricalPriceSeries, PriceData } from "./oracle-utils";
import { checkTWAPFalsePositive } from "./twap-checker";

const RPC_URL = "http://127.0.0.1:8899";
const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Yg5pL5");
const DEFAULT_LAG_SECONDS = 45;
const SIM_DURATION_SLOTS = 7 * 24 * 60 * 60 * 2; // ~7 days at 2 slots/sec
const TWAP_WINDOW_SLOTS = 15 * 2; // 15s TWAP

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = new Program<Vault>(
    require("../target/idl/vault.json"),
    provider
  );

  // Initialize on-chain vault (once)
  const vaultKeypair = Keypair.generate();
  const protectionBuffer = Keypair.generate();

  console.log("Initializing vault...");
  await program.methods
    .initialize()
    .accounts({
      vault: vaultKeypair.publicKey,
      owner: provider.wallet.publicKey,
      protectionBuffer: protectionBuffer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([vaultKeypair, protectionBuffer])
    .rpc();

  console.log(`Vault initialized at ${vaultKeypair.publicKey}`);

  // Load historical JitoSOL price series (simulating oracle feed)
  const priceHistory: HistoricalPriceSeries = getHistoricalJitoPrices();

  // Configure lag injector for 45s oracle lag
  const config: LagInjectorConfig = {
    lagSeconds: DEFAULT_LAG_SECONDS,
    slotDurationMs: 500, // ~2Hz test validator
  };
  const injector = new LagInjector(priceHistory, config);

  console.log("Starting 7-day on-chain simulation with lag injection...");

  let breakerTrips = 0;
  let falsePositives = 0;
  let currentSlot = 0;

  // Replay series with lag
  while (currentSlot < SIM_DURATION_SLOTS) {
    // Inject lagged price at current slot
    injector.injectPriceAtSlot(currentSlot);

    const currentPrice = injector.getCurrentPrice();
    if (!currentPrice) {
      currentSlot++;
      continue;
    }

    // Run 15s TWAP false-positive checker
    const historyForTWAP = injector.getPriceHistory().slice(-TWAP_WINDOW_SLOTS);
    const isFalsePositive = checkTWAPFalsePositive(historyForTWAP, currentPrice);

    if (isFalsePositive) {
      falsePositives++;
      console.log(`Slot ${currentSlot}: TWAP false positive detected (price: ${currentPrice.price})`);
    }

    // Simulate drawdown circuit-breaker instruction (on-chain check)
    try {
      await program.methods
        .checkDrawdown()
        .accounts({
          vault: vaultKeypair.publicKey,
          oracle: PublicKey.default, // mocked oracle in sim
        })
        .rpc();
    } catch (err: any) {
      if (err.toString().includes("DrawdownBreached")) {
        breakerTrips++;
        console.log(`Slot ${currentSlot}: CIRCUIT BREAKER TRIPPED (price: ${currentPrice.price})`);
      }
    }

    currentSlot++;

    // Log progress every simulated hour
    if (currentSlot % 7200 === 0) {
      console.log(`Progress: ${Math.round((currentSlot / SIM_DURATION_SLOTS) * 100)}% - Trips: ${breakerTrips}, False Pos: ${falsePositives}`);
    }
  }

  console.log("\n=== Simulation Complete ===");
  console.log(`Total circuit breaker trips: ${breakerTrips}`);
  console.log(`TWAP false positives: ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / (breakerTrips || 1)) * 100).toFixed(2)}%`);
}

main().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
