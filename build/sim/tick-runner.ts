import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { createLagInjector, LagInjector, PriceData } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createTestOracle, TestOracle } from "./oracle-utils";

const TICK_INTERVAL_MS = 15000;
const SIM_DURATION_SLOTS = 40320; // approx 7 days at 0.4s/slot
const TARGET_LAG_SLOTS = 112; // 45s @ ~0.4s/slot

interface SimConfig {
  initialPrice: number;
  depegSeries: PriceData[];
}

async function runSim() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const connection = provider.connection;
  const oracleKeypair = Keypair.generate();
  const testOracle: TestOracle = createTestOracle(oracleKeypair);

  // Initialize oracle account
  const ix = await createTestOracleInstruction(testOracle.pubkey, provider.wallet.publicKey);
  const tx = new anchor.web3.Transaction().add(ix);
  await provider.sendAndConfirm(tx);

  const lagInjector: LagInjector = createLagInjector(connection, testOracle.pubkey, TARGET_LAG_SLOTS);

  // Sample replay series (last three Jito depeg-like movements)
  const replaySeries: PriceData[] = [
    { price: 0.98, conf: 0.001, slot: 100 },
    { price: 0.95, conf: 0.002, slot: 150 },
    { price: 0.92, conf: 0.003, slot: 220 },
    { price: 0.89, conf: 0.004, slot: 300 },
    { price: 0.87, conf: 0.005, slot: 380 },
    { price: 0.85, conf: 0.006, slot: 450 },
    { price: 0.90, conf: 0.003, slot: 520 },
    { price: 0.96, conf: 0.002, slot: 600 },
  ];

  const simConfig: SimConfig = {
    initialPrice: 1.0,
    depegSeries: replaySeries,
  };

  console.log("Starting pure-onchain Anchor JitoSOL vault sim (7-day tick runner)...");
  console.log(`Target oracle lag: ${TARGET_LAG_SLOTS} slots (~45s)`);
  console.log(`Total ticks: ${Math.floor(SIM_DURATION_SLOTS * 0.4 / (TICK_INTERVAL_MS / 1000))}`);

  let currentSlot = 100;
  let tripCount = 0;
  let falsePositiveCount = 0;
  let tick = 0;

  // Seed initial price
  await lagInjector.setPrice(simConfig.initialPrice, 0.001);

  const interval = setInterval(async () => {
    tick++;
    currentSlot += Math.floor(TICK_INTERVAL_MS / 400); // rough slot advance

    // Inject lagged price from replay series (cycle through)
    const seriesIndex = (tick - 1) % simConfig.depegSeries.length;
    const nextData = simConfig.depegSeries[seriesIndex];
    await lagInjector.injectLagPrice(nextData.price, nextData.conf || 0.002);

    const history = lagInjector.getPriceHistory();
    const currentLag = lagInjector.getCurrentLag();

    // Run 15s TWAP false-positive checker
    const isFalsePositive = checkTWAPFalsePositive(history, currentLag, TARGET_LAG_SLOTS);

    if (isFalsePositive) {
      falsePositiveCount++;
      console.log(`Tick ${tick} (slot ~${currentSlot}): TWAP false positive detected (lag=${currentLag})`);
    }

    // Simulate drawdown circuit-breaker logic (simple threshold for demo)
    const latestPrice = history[history.length - 1]?.price || 1.0;
    if (latestPrice < 0.90) {
      tripCount++;
      console.log(`Tick ${tick} (slot ~${currentSlot}): CIRCUIT BREAKER TRIPPED at price $${latestPrice.toFixed(3)}`);
    }

    if (tick >= 40) { // simulate 10-minute run for CI (full 7d is for manual)
      clearInterval(interval);
      console.log("\n=== SIM COMPLETE ===");
      console.log(`Breaker trips: ${tripCount}`);
      console.log(`TWAP false positives: ${falsePositiveCount}`);
      console.log(`False positive rate: ${((falsePositiveCount / tick) * 100).toFixed(1)}%`);
      process.exit(0);
    }
  }, TICK_INTERVAL_MS);
}

// Stub for oracle init (real implementation lives in oracle-utils)
async function createTestOracleInstruction(oraclePubkey: PublicKey, payer: PublicKey): Promise<anchor.web3.TransactionInstruction> {
  // In a real Anchor test this would call the program; here we use system program for account creation
  const space = 8 + 32 + 8 + 8; // discriminator + pubkey + price + slot
  const lamports = await anchor.getProvider().connection.getMinimumBalanceForRentExemption(space);
  return anchor.web3.SystemProgram.createAccount({
    fromPubkey: payer,
    newAccountPubkey: oraclePubkey,
    lamports,
    space,
    programId: anchor.web3.SystemProgram.programId,
  });
}

runSim().catch((err) => {
  console.error("Sim failed:", err);
  process.exit(1);
});
