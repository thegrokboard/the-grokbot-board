import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { LagInjector, LagInjectorConfig } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";
import { Vault } from "../target/types/vault";

const TICK_INTERVAL_MS = 15000; // 15s TWAP false-positive checker
const TARGET_LAG_SLOTS = 900;   // ~45s at 50ms/slot
const MAX_TICKS = 40320;        // 7 days @ 15s ticks

async function runSimulation() {
  // Setup local test validator connection
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const provider = new anchor.AnchorProvider(connection, anchor.Wallet.local(), {});
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as anchor.Program<Vault>;
  const owner = (provider.wallet as anchor.Wallet).payer;

  // Protection buffer and vault accounts (minimal PDA setup)
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.publicKey.toBuffer()],
    program.programId
  );
  const [bufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("buffer"), vaultPda.toBuffer()],
    program.programId
  );

  // Load historical JitoSOL price series
  const series: PriceData[] = await getHistoricalJitoPrices();
  console.log(`Loaded ${series.length} historical JitoSOL price points for replay.`);

  // Configure and instantiate lag injector (45s target lag)
  const config: LagInjectorConfig = {
    targetLagMs: 45000,
    slotDurationMs: 400, // conservative for test validator
  };
  const injector = new LagInjector(connection, config);

  await injector.loadSeries(series);

  console.log("Starting 7-day onchain simulation with 15s ticks...");

  let breakerTrips = 0;
  let falsePositives = 0;
  let tick = 0;
  let lastLog = Date.now();

  while (tick < MAX_TICKS) {
    const now = Date.now();
    if (now - lastLog > 60000) {
      console.log(`Progress: tick ${tick}/${MAX_TICKS} (${Math.round((tick / MAX_TICKS) * 100)}%) - trips: ${breakerTrips}, falsePos: ${falsePositives}`);
      lastLog = now;
    }

    // Inject lagged price into test validator oracle account
    const currentPrice = await injector.getCurrentPrice(tick);
    if (currentPrice) {
      // Simulate drawdown circuit-breaker check (program call would go here in full harness)
      const isDrawdown = currentPrice.price < 0.92; // simplified threshold for sim
      if (isDrawdown) {
        breakerTrips++;
        console.log(`Breaker trip at tick ${tick} - price: ${currentPrice.price}`);
      }

      // Run 15s TWAP false-positive checker
      const isFalsePositive = checkTWAPFalsePositive(series, tick, TARGET_LAG_SLOTS);
      if (isFalsePositive) {
        falsePositives++;
      }
    }

    tick++;
    await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS));
  }

  console.log("\n=== Simulation Complete ===");
  console.log(`Breaker trips: ${breakerTrips}`);
  console.log(`False positives (15s TWAP): ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / breakerTrips) * 100).toFixed(2)}%`);
}

runSimulation().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
