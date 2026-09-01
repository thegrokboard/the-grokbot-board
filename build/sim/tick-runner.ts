import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import { createLagInjector, LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createTestOracle, PriceData, OracleUtils } from "./oracle-utils";
import { Vault } from "../target/types/vault";

const TICK_INTERVAL_MS = 15000;
const REPLAY_SERIES: PriceData[] = [
  { price: 0.98, conf: 0.005, slot: 100 },
  { price: 0.95, conf: 0.008, slot: 110 },
  { price: 0.92, conf: 0.012, slot: 120 },
  { price: 0.89, conf: 0.015, slot: 130 },
  { price: 0.87, conf: 0.018, slot: 140 },
];

async function runSim() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as anchor.Program<Vault>;
  const connection = provider.connection;

  const oracle = await createTestOracle(connection, provider.wallet as any);
  const oraclePubkey = oracle.publicKey;

  const lagInjector: LagInjector = createLagInjector(connection, oraclePubkey, 45);

  console.log("=== Pure Onchain Anchor JitoSOL Depeg Sim ===");
  console.log(`Target lag: 45 slots (~${(45 * 0.4).toFixed(1)}s)`);
  console.log(`TWAP window: 15s | Replay length: ${REPLAY_SERIES.length}\n`);

  let currentIndex = 0;
  let breakerTrips = 0;
  let falsePositives = 0;
  let totalTicks = 0;

  const tick = async () => {
    totalTicks++;
    const data = REPLAY_SERIES[currentIndex % REPLAY_SERIES.length];
    currentIndex++;

    await lagInjector.setPrice(data.price, data.conf);

    const isFalsePositive = checkTWAPFalsePositive(
      lagInjector.getPriceHistory(),
      0.90,
      15
    );

    console.log(
      `[tick ${totalTicks}] price=${data.price.toFixed(3)} ` +
      `conf=${data.conf.toFixed(3)} ` +
      `lag=${lagInjector.getCurrentLag()}s ` +
      `fp=${isFalsePositive}`
    );

    if (isFalsePositive) falsePositives++;

    if (data.price < 0.90) {
      console.log("  -> drawdown circuit breaker TRIPPED");
      breakerTrips++;
    }
  };

  for (let i = 0; i < 20; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, TICK_INTERVAL_MS));
  }

  console.log("\n=== SIM COMPLETE ===");
  console.log(`Total ticks: ${totalTicks}`);
  console.log(`Breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / totalTicks) * 100).toFixed(1)}%`);
}

runSim().catch((err) => {
  console.error("Sim failed:", err);
  process.exit(1);
});
