import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { LagInjector, PriceData } from "./lag-injector";
import { getHistoricalJitoPrices } from "./oracle-utils";
import { checkTWAPFalsePositive } from "./twap-checker";

const LAG_TARGET_SLOTS = 90; // ~45s at 500ms/slot
const TWAP_WINDOW_SLOTS = 30; // 15s TWAP
const TICK_INTERVAL_MS = 15000;
const TOTAL_TICKS = 7 * 24 * 60 * 4; // 7 days @ 15s ticks

interface SimulationConfig {
  lagSlots: number;
  twapSlots: number;
  replaySeries: PriceData[];
}

async function runSimulation(): Promise<void> {
  console.log("Starting pure-onchain Anchor JitoSOL depeg protection sim...");

  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const payer = Keypair.generate();

  // Fund payer
  const airdropSig = await connection.requestAirdrop(payer.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdropSig);

  const historicalPrices: PriceData[] = await getHistoricalJitoPrices();
  console.log(`Loaded ${historicalPrices.length} historical JitoSOL price points`);

  const injector = new LagInjector(connection, payer, {
    lagSlots: LAG_TARGET_SLOTS,
    replaySeries: historicalPrices,
    oracleProgramId: new PublicKey("11111111111111111111111111111111"), // placeholder for sim
  });

  await injector.loadSeries();

  let breakerTrips = 0;
  let falsePositives = 0;
  let currentSlot = 200; // arbitrary starting slot

  console.log(`Running ${TOTAL_TICKS} ticks (7-day sim @ 15s intervals)...`);

  for (let tick = 0; tick < TOTAL_TICKS; tick++) {
    const laggedPrice = injector.getCurrentPrice(currentSlot);
    const twapOk = checkTWAPFalsePositive(
      injector.getPriceHistory(),
      currentSlot,
      TWAP_WINDOW_SLOTS
    );

    if (!twapOk) {
      falsePositives++;
      console.log(`Tick ${tick} (slot ${currentSlot}): TWAP false positive detected`);
    }

    // Simulate drawdown circuit breaker logic (simplified on-chain equivalent)
    if (laggedPrice && laggedPrice.price < 0.85) {
      breakerTrips++;
      console.log(`Tick ${tick} (slot ${currentSlot}): Circuit breaker TRIPPED at price ${laggedPrice.price}`);
    }

    currentSlot += 30; // advance ~15s
    await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS / 10)); // speed up sim
  }

  console.log("\n=== Simulation Complete ===");
  console.log(`Breaker trips: ${breakerTrips}`);
  console.log(`TWAP false positives: ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / TOTAL_TICKS) * 100).toFixed(2)}%`);
}

runSimulation().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
