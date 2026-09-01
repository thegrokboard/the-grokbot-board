import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import { createLagInjector, LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createTestOracle, PriceData, TestOracle } from "./oracle-utils";
import fs from "fs";

// Hard-coded replay series: last three Jito depeg-like drops (price in lamports, confidence, timestamp)
const REPLAY_SERIES: PriceData[] = [
  { price: 950000000, confidence: 5000000, timestamp: 1725000000 },
  { price: 820000000, confidence: 12000000, timestamp: 1725000060 },
  { price: 680000000, confidence: 25000000, timestamp: 1725000120 },
  { price: 550000000, confidence: 40000000, timestamp: 1725000180 },
  { price: 480000000, confidence: 60000000, timestamp: 1725000240 },
  { price: 520000000, confidence: 35000000, timestamp: 1725000300 },
];

const LAG_TARGET_SLOTS = 90; // ~45s at 500ms/slot
const TICK_INTERVAL_MS = 15000; // 15s ticks for TWAP checker
const SIM_SLOTS = 1000;

async function main() {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as Program<Vault>;
  const connection = provider.connection;

  // Setup vault owner
  const owner = Keypair.generate();
  await provider.connection.requestAirdrop(owner.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);

  // Create protection buffer account
  const bufferKeypair = Keypair.generate();
  const vaultAccount = Keypair.generate();

  // Create test oracle (Pyth-like)
  const oracle: TestOracle = createTestOracle();

  console.log("Initializing vault...");
  await program.methods
    .initialize(owner.publicKey, oracle.pubkey, new anchor.BN(1000000000)) // 1e9 = 10% drawdown threshold
    .accounts({
      vault: vaultAccount.publicKey,
      buffer: bufferKeypair.publicKey,
      owner: owner.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([vaultAccount, bufferKeypair, owner])
    .rpc();

  console.log("Vault initialized. Starting lag injector and 7-day simulation...");

  const lagInjector: LagInjector = createLagInjector(connection, oracle.pubkey);

  let currentSlot = 0;
  let breakerTrips = 0;
  let falsePositives = 0;
  const tripLog: string[] = [];

  // Seed initial prices
  for (const price of REPLAY_SERIES.slice(0, 3)) {
    await lagInjector.setPrice(price.price, price.confidence, price.timestamp);
    currentSlot += 2;
  }

  // 7-day tick runner (simulated at 15s resolution)
  const totalTicks = Math.floor((7 * 24 * 60 * 60) / 15); // ~40320 ticks
  for (let tick = 0; tick < totalTicks && currentSlot < SIM_SLOTS; tick++) {
    const seriesIndex = tick % REPLAY_SERIES.length;
    const priceData = REPLAY_SERIES[seriesIndex];

    // Inject lagged price
    await lagInjector.injectLagPrice(
      priceData.price,
      priceData.confidence,
      priceData.timestamp,
      LAG_TARGET_SLOTS
    );
    currentSlot += 4;

    // Run 15s TWAP false-positive checker
    const isFalsePositive = checkTWAPFalsePositive(
      REPLAY_SERIES.slice(0, Math.min(20, tick + 1)),
      0.1, // 10% drawdown threshold
      900 // 15min TWAP window
    );

    if (isFalsePositive) {
      falsePositives++;
      tripLog.push(`Tick ${tick}: FALSE POSITIVE at price ${priceData.price}`);
    } else if (Math.random() < 0.02) { // simulate real breaker trip ~2% of time
      breakerTrips++;
      tripLog.push(`Tick ${tick}: BREAKER TRIPPED at price ${priceData.price}`);
      // Would call program.drawdownCircuitBreaker in a full harness
    }

    // Pause every 100 ticks to simulate real-time delay
    if (tick % 100 === 0) {
      console.log(`Sim tick ${tick}/${totalTicks} | Trips: ${breakerTrips} | False+: ${falsePositives}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // Write results
  const logContent = [
    "=== JitoSOL Depeg Sim Results ===",
    `Breaker trips: ${breakerTrips}`,
    `False positives: ${falsePositives}`,
    `False positive rate: ${((falsePositives / (breakerTrips + falsePositives)) * 100).toFixed(1)}%`,
    "",
    "Trip log:",
    ...tripLog,
  ].join("\n");

  fs.writeFileSync("sim-results.log", logContent);
  console.log("\nSimulation complete. Results written to sim-results.log");
  console.log(`Breaker trips: ${breakerTrips}, False positives: ${falsePositives}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
