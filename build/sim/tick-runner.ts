import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import { LagInjector, LagInjectorConfig } from "./lag-injector";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";
import { checkTWAPFalsePositive } from "./twap-checker";

const RPC_URL = "http://127.0.0.1:8899";
const LAG_SECONDS = 45;
const TICK_INTERVAL_MS = 15000;
const SIM_DAYS = 7;
const SLOTS_PER_SECOND = 2; // approximate

interface SimConfig {
  lagSeconds: number;
  twapWindowSeconds: number;
  falsePositiveThreshold: number;
}

async function main() {
  // Setup provider
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as Program<Vault>;

  // Initialize accounts (minimal for sim)
  const vault = Keypair.generate();
  const protectionBuffer = Keypair.generate();
  const owner = wallet.payer;

  console.log("Initializing vault for simulation...");
  await program.methods
    .initialize()
    .accounts({
      vault: vault.publicKey,
      protectionBuffer: protectionBuffer.publicKey,
      owner: owner.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([vault, protectionBuffer])
    .rpc();

  console.log("Vault initialized. Starting 7-day simulation...");

  const historicalPrices: PriceData[] = getHistoricalJitoPrices();

  const injectorConfig: LagInjectorConfig = {
    lagSeconds: LAG_SECONDS,
    slotDurationMs: 400,
  };

  const injector = new LagInjector(historicalPrices, injectorConfig);

  const simConfig: SimConfig = {
    lagSeconds: LAG_SECONDS,
    twapWindowSeconds: 900, // 15 min
    falsePositiveThreshold: 0.05,
  };

  let breakerTrips = 0;
  let falsePositives = 0;
  let totalTicks = 0;

  const startSlot = 0;
  const totalSlots = SIM_DAYS * 24 * 60 * 60 * SLOTS_PER_SECOND;
  const ticks = Math.floor(totalSlots / (TICK_INTERVAL_MS / 400));

  for (let i = 0; i < ticks; i++) {
    const currentSlot = startSlot + i * (TICK_INTERVAL_MS / 400);

    injector.injectPriceAtSlot(currentSlot);

    const currentPrice = injector.getCurrentPrice();
    if (!currentPrice) continue;

    const priceHistory = injector.getPriceHistory();

    const isFalsePositive = checkTWAPFalsePositive(
      priceHistory,
      currentPrice,
      simConfig.twapWindowSeconds,
      simConfig.falsePositiveThreshold
    );

    // Simulate on-chain drawdown circuit breaker check
    if (currentPrice.price < 0.85) {
      console.log(`[${currentSlot}] Price depeg detected: ${currentPrice.price.toFixed(4)}`);
      try {
        await program.methods
          .triggerDrawdown()
          .accounts({
            vault: vault.publicKey,
            owner: owner.publicKey,
          })
          .rpc();
        breakerTrips++;
      } catch (e) {
        console.warn("Breaker already tripped or instruction failed");
      }
    }

    if (isFalsePositive) {
      falsePositives++;
    }

    totalTicks++;
    if (totalTicks % 100 === 0) {
      console.log(`Tick ${totalTicks}: breakerTrips=${breakerTrips}, falsePositives=${falsePositives}`);
    }

    // Sleep to simulate real-time
    await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS / 10)); // speed up sim
  }

  console.log("\n=== Simulation Complete ===");
  console.log(`Total ticks: ${totalTicks}`);
  console.log(`Circuit breaker trips: ${breakerTrips}`);
  console.log(`False positives (15s TWAP): ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / totalTicks) * 100).toFixed(2)}%`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
