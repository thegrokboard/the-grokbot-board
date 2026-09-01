import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createLagInjector, LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createTestOracle, updateTestOracle, PriceData, OracleConfig } from "./oracle-utils";

const CLUSTER_URL = "http://127.0.0.1:8899";
const DEFAULT_LAG_SLOTS = 135; // ~45s at 333ms/slot

interface SimConfig {
  oraclePubkey: PublicKey;
  lagSlots: number;
  initialPrice: number;
  series: PriceData[];
}

async function main() {
  const connection = new Connection(CLUSTER_URL, "confirmed");
  const payer = Keypair.generate();

  // Fund payer
  const airdropSig = await connection.requestAirdrop(payer.publicKey, 10 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdropSig);

  const oracleConfig: OracleConfig = {
    feedPubkey: new PublicKey("11111111111111111111111111111111"),
    admin: payer,
  };

  const oraclePubkey = await createTestOracle(connection, payer, oracleConfig);
  console.log("Test oracle created:", oraclePubkey.toBase58());

  const injector: LagInjector = createLagInjector(connection, payer, oraclePubkey);

  // Sample replay series (last three Jito depeg-ish points)
  const priceSeries: PriceData[] = [
    { price: 0.92, confidence: 0.01, timestamp: Date.now() / 1000, slot: 100 },
    { price: 0.85, confidence: 0.02, timestamp: Date.now() / 1000 + 5, slot: 115 },
    { price: 0.78, confidence: 0.015, timestamp: Date.now() / 1000 + 12, slot: 150 },
  ];

  const simConfig: SimConfig = {
    oraclePubkey,
    lagSlots: DEFAULT_LAG_SLOTS,
    initialPrice: 1.0,
    series: priceSeries,
  };

  console.log("Starting pure-onchain Anchor JitoSOL depeg sim...");
  await runSimulation(connection, payer, injector, simConfig);
}

async function runSimulation(
  connection: Connection,
  payer: Keypair,
  injector: LagInjector,
  config: SimConfig
) {
  let currentSlot = 200;
  let tripped = false;
  let falsePositives = 0;

  // Seed initial price
  await updateTestOracle(
    connection,
    payer,
    config.oraclePubkey,
    config.initialPrice,
    0.005,
    Date.now() / 1000,
    currentSlot
  );

  for (const priceData of config.series) {
    currentSlot += 15; // 15s tick

    const laggedPrice = {
      ...priceData,
      slot: Math.max(0, currentSlot - config.lagSlots),
    };

    // Inject lagged price
    await injector.injectLagPrice(
      connection,
      payer,
      config.oraclePubkey,
      laggedPrice,
      config.lagSlots
    );

    // Check TWAP false-positive
    const isFalsePositive = await checkTWAPFalsePositive(
      connection,
      config.oraclePubkey,
      currentSlot,
      15 // 15s window
    );

    if (isFalsePositive) {
      falsePositives++;
      console.log(`[${currentSlot}] TWAP false-positive detected`);
    } else if (laggedPrice.price < 0.90) {
      tripped = true;
      console.log(`[${currentSlot}] CIRCUIT BREAKER TRIPPED at price ${laggedPrice.price}`);
      break;
    } else {
      console.log(`[${currentSlot}] price=${laggedPrice.price.toFixed(3)} (no trip)`);
    }
  }

  console.log("\n=== SIM COMPLETE ===");
  console.log(`Breaker trips: ${tripped ? 1 : 0}`);
  console.log(`False positives: ${falsePositives}`);
  console.log(`Target lag: ~45s (${config.lagSlots} slots)`);
}

main().catch((err) => {
  console.error("Sim failed:", err);
  process.exit(1);
});
