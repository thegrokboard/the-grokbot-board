import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createLagInjector, injectLagPrice } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createPriceAccount, updatePriceAccount, PriceData } from "./oracle-utils";

const RPC_URL = "http://127.0.0.1:8899";
const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn");
const ORACLE_PROGRAM_ID = new PublicKey("11111111111111111111111111111111"); // placeholder for sim

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;

  console.log("Starting 7-day tick runner simulation...");

  // Setup price account for simulation
  const priceKeypair = Keypair.generate();
  await createPriceAccount(connection, wallet.payer, priceKeypair, ORACLE_PROGRAM_ID);

  const lagInjector = createLagInjector(connection, wallet.payer, priceKeypair.publicKey, 45);

  // Replay last three Jito depeg price series (simulated data)
  const priceSeries: PriceData[] = [
    { price: 0.95, confidence: 0.01, timestamp: Date.now() / 1000 - 3600 },
    { price: 0.92, confidence: 0.015, timestamp: Date.now() / 1000 - 1800 },
    { price: 0.88, confidence: 0.02, timestamp: Date.now() / 1000 - 900 },
  ];

  let breakerTrips = 0;
  let falsePositives = 0;
  const TICK_INTERVAL_MS = 15000; // 15s ticks
  const TOTAL_TICKS = 7 * 24 * 60 * 4; // 7 days of 15s ticks

  for (let tick = 0; tick < TOTAL_TICKS; tick++) {
    const currentTime = Date.now() / 1000 + tick * 15;
    const seriesIndex = Math.min(Math.floor(tick / (TOTAL_TICKS / priceSeries.length)), priceSeries.length - 1);
    const priceData = priceSeries[seriesIndex];

    // Inject lagged price
    await injectLagPrice(lagInjector, priceData.price, priceData.confidence, currentTime);

    // Update oracle account
    await updatePriceAccount(
      connection,
      wallet.payer,
      priceKeypair.publicKey,
      priceData.price,
      priceData.confidence,
      ORACLE_PROGRAM_ID
    );

    // Check TWAP for false positive
    const isFalsePositive = checkTWAPFalsePositive(
      connection,
      priceKeypair.publicKey,
      0.90, // threshold
      3600 // 1h window
    );

    if (isFalsePositive) {
      falsePositives++;
      console.log(`Tick ${tick}: TWAP false positive detected`);
    }

    // Simulate drawdown circuit-breaker check (placeholder for vault program CPI)
    if (priceData.price < 0.90 && !isFalsePositive) {
      breakerTrips++;
      console.log(`Tick ${tick}: Circuit breaker tripped at price ${priceData.price}`);
    }

    if (tick % 100 === 0) {
      console.log(`Progress: ${Math.round((tick / TOTAL_TICKS) * 100)}% - Trips: ${breakerTrips}, False Pos: ${falsePositives}`);
    }

    // Simulate real-time delay (not in actual test run)
    // await new Promise(r => setTimeout(r, TICK_INTERVAL_MS));
  }

  console.log("\nSimulation complete!");
  console.log(`Breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / (breakerTrips || 1)) * 100).toFixed(2)}%`);
}

main().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
