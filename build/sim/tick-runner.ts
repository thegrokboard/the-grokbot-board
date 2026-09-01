import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createLagInjector, injectLagPrice } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createPriceAccount, updatePriceAccount, PriceData } from "./oracle-utils";

const TICK_INTERVAL_MS = 15000; // 15s ticks
const RUN_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TARGET_LAG_SLOTS = 150; // ~45s at 300ms/slot

async function main() {
  // Setup provider and payer
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const payer = (provider.wallet as anchor.Wallet).payer;

  const connection = provider.connection;

  console.log("Starting pure-onchain Anchor JitoSOL depeg sim harness...");

  // Create oracle price account
  const oracleKeypair = Keypair.generate();
  await createPriceAccount(connection, payer, oracleKeypair);
  console.log(`Oracle price account: ${oracleKeypair.publicKey.toBase58()}`);

  // Initialize lag injector (replays last 3 Jito depeg series)
  const lagInjector = createLagInjector(TARGET_LAG_SLOTS);
  console.log(`Lag injector ready (target lag: ${TARGET_LAG_SLOTS} slots)`);

  let tickCount = 0;
  let breakerTrips = 0;
  let falsePositives = 0;
  const startTime = Date.now();

  const interval = setInterval(async () => {
    try {
      tickCount++;
      const now = Date.now();
      const elapsedHours = ((now - startTime) / (1000 * 60 * 60)).toFixed(2);

      // Inject lagged price from replay series
      const priceData: PriceData = injectLagPrice(lagInjector, connection, oracleKeypair.publicKey);
      await updatePriceAccount(connection, payer, oracleKeypair.publicKey, priceData);

      // Run 15s TWAP false-positive checker
      const isFalsePositive = checkTWAPFalsePositive([priceData]); // uses last tick only in this minimal harness
      if (isFalsePositive) {
        falsePositives++;
        console.log(`[${elapsedHours}h] TICK ${tickCount} - FALSE POSITIVE detected`);
      } else {
        console.log(`[${elapsedHours}h] TICK ${tickCount} - price injected (no trip)`);
      }

      // Simulate drawdown circuit-breaker trip (placeholder logic)
      if (priceData.price < 0.85) { // example threshold for jitoSOL depeg
        breakerTrips++;
        console.log(`[${elapsedHours}h] BREAKER TRIPPED on depeg! (trip #${breakerTrips})`);
      }

      if (now - startTime > RUN_DURATION_MS) {
        clearInterval(interval);
        console.log("\n=== SIM COMPLETE ===");
        console.log(`Total ticks: ${tickCount}`);
        console.log(`Breaker trips: ${breakerTrips}`);
        console.log(`False positives: ${falsePositives}`);
        console.log("Log written to sim.log (in real run)");
        process.exit(0);
      }
    } catch (err) {
      console.error("Tick error:", err);
    }
  }, TICK_INTERVAL_MS);

  // Keep process alive
  process.on("SIGINT", () => {
    clearInterval(interval);
    console.log("\nSim interrupted.");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
