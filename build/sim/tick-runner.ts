import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { createLagInjector, LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createTestOracle, PriceData, TestOracle } from "./oracle-utils";

const RPC_URL = "http://127.0.0.1:8899";
const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6YgV2v");
const ORACLE_LAG_SLOTS = 135; // ~45s at 333ms/slot
const TWAP_PERIOD_SLOTS = 45; // 15s TWAP

interface SimResult {
  breakerTrips: number;
  falsePositives: number;
  totalTicks: number;
}

async function runTickSimulation(): Promise<SimResult> {
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = Keypair.generate();
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {});
  anchor.setProvider(provider);

  const oracle: TestOracle = createTestOracle();
  const lagInjector: LagInjector = createLagInjector(connection, oracle.pubkey, ORACLE_LAG_SLOTS);

  // Replay last three known Jito depeg series (synthetic normalized prices around 0.92-1.05)
  const priceSeries: PriceData[] = [
    { price: 1.00, confidence: 0.01, timestamp: Date.now() / 1000 },
    { price: 0.98, confidence: 0.02, timestamp: Date.now() / 1000 + 1 },
    { price: 0.95, confidence: 0.03, timestamp: Date.now() / 1000 + 2 },
    { price: 0.93, confidence: 0.04, timestamp: Date.now() / 1000 + 3 },
    { price: 0.92, confidence: 0.05, timestamp: Date.now() / 1000 + 4 },
    { price: 0.94, confidence: 0.03, timestamp: Date.now() / 1000 + 5 },
    { price: 0.97, confidence: 0.02, timestamp: Date.now() / 1000 + 6 },
    { price: 1.00, confidence: 0.01, timestamp: Date.now() / 1000 + 7 },
    { price: 1.03, confidence: 0.02, timestamp: Date.now() / 1000 + 8 },
    { price: 1.05, confidence: 0.03, timestamp: Date.now() / 1000 + 9 },
    { price: 1.02, confidence: 0.02, timestamp: Date.now() / 1000 + 10 },
    { price: 0.99, confidence: 0.01, timestamp: Date.now() / 1000 + 11 },
  ];

  let breakerTrips = 0;
  let falsePositives = 0;
  const totalTicks = priceSeries.length * 3; // simulate 3 replay passes

  console.log("Starting pure-onchain Anchor JitoSOL depeg sim with lag injector...");

  for (let pass = 0; pass < 3; pass++) {
    console.log(`Replay pass ${pass + 1}/3`);
    for (let i = 0; i < priceSeries.length; i++) {
      const pd = priceSeries[i];
      const slot = (pass * priceSeries.length) + i + 1000;

      // Inject lagged price
      await lagInjector.injectLagPrice(pd.price, pd.confidence, slot);

      // Run 15s TWAP false-positive checker
      const twapResult = checkTWAPFalsePositive(
        oracle.pubkey,
        pd.price,
        pd.confidence,
        TWAP_PERIOD_SLOTS,
        slot
      );

      if (typeof twapResult === "boolean") {
        if (twapResult) {
          breakerTrips++;
          console.log(`  Tick ${slot}: BREAKER TRIPPED (price=${pd.price})`);
        }
      } else {
        if (twapResult.isFalsePositive) {
          falsePositives++;
          console.log(`  Tick ${slot}: false positive detected (price=${pd.price})`);
        }
        if (twapResult.shouldTrip) {
          breakerTrips++;
          console.log(`  Tick ${slot}: BREAKER TRIPPED (price=${pd.price})`);
        }
      }
    }
  }

  const result: SimResult = { breakerTrips, falsePositives, totalTicks };
  console.log("\nSimulation complete:");
  console.log(`  Breaker trips: ${result.breakerTrips}`);
  console.log(`  False positives: ${result.falsePositives}`);
  console.log(`  Total ticks: ${result.totalTicks}`);
  return result;
}

async function main() {
  try {
    await runTickSimulation();
  } catch (err) {
    console.error("Sim failed:", err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { runTickSimulation, SimResult };
