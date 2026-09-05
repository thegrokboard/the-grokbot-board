import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalPriceSeries } from "./oracle-utils";

interface SimConfig {
  lagSeconds: number;
  twapPeriodSeconds: number;
  depegThresholdBps: number;
  replaySeriesCount: number;
  tickIntervalMs: number;
}

const CONFIG: SimConfig = {
  lagSeconds: 45,
  twapPeriodSeconds: 15,
  depegThresholdBps: 500,
  replaySeriesCount: 3,
  tickIntervalMs: 15000,
};

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program<Vault>(
    require("../target/idl/vault.json"),
    provider
  );

  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  console.log("Starting pure-onchain Anchor JitoSOL depeg sim harness...");

  // Load historical JitoSOL price series (last 3 depeg events)
  const seriesList: any[] = await getHistoricalPriceSeries(CONFIG.replaySeriesCount);
  console.log(`Loaded ${seriesList.length} historical price series for replay.`);

  const injector = new LagInjector(connection, {
    lagSeconds: CONFIG.lagSeconds,
    oracleProgramId: new PublicKey("oracle111111111111111111111111111111111111111"),
    priceFeedPubkey: new PublicKey("price111111111111111111111111111111111111111"),
  });

  // Setup on-chain vault accounts
  const vaultKeypair = Keypair.generate();
  const bufferKeypair = Keypair.generate();
  const owner = payer;

  console.log("Initializing vault and protection buffer...");
  await program.methods
    .initialize(owner.publicKey, new anchor.BN(1000)) // example buffer size in lamports
    .accounts({
      vault: vaultKeypair.publicKey,
      protectionBuffer: bufferKeypair.publicKey,
      owner: owner.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([vaultKeypair, bufferKeypair])
    .rpc();

  console.log("Vault initialized. Starting 7-day tick simulation (replay mode)...");

  let tickCount = 0;
  const maxTicks = 7 * 24 * 60 * 4; // ~7 days at 15s ticks
  let breakerTrips = 0;
  let falsePositives = 0;

  const runTick = async () => {
    if (tickCount >= maxTicks) {
      console.log("\nSimulation complete.");
      console.log(`Breaker trips: ${breakerTrips}`);
      console.log(`False positives (TWAP): ${falsePositives}`);
      process.exit(0);
    }

    const seriesIndex = tickCount % seriesList.length;
    const currentSeries = seriesList[seriesIndex];

    // Inject lagged price at current simulated slot time
    const simulatedTimestamp = Date.now() / 1000;
    await injector.injectLaggedPrice(currentSeries, simulatedTimestamp);

    // Run TWAP false-positive checker on the injected series
    const recentPrices = currentSeries.prices.slice(0, 10); // last N points for TWAP
    const isFalsePositive = checkTWAPFalsePositive(recentPrices, CONFIG.twapPeriodSeconds, CONFIG.depegThresholdBps);

    if (isFalsePositive) {
      falsePositives++;
      console.log(`Tick ${tickCount}: TWAP false positive detected (no breaker trip).`);
    } else {
      // Trigger on-chain drawdown circuit breaker if real depeg
      try {
        await program.methods
          .triggerDrawdown()
          .accounts({
            vault: vaultKeypair.publicKey,
            protectionBuffer: bufferKeypair.publicKey,
            owner: owner.publicKey,
            priceOracle: injector.getPriceFeedPubkey(),
          })
          .rpc();
        breakerTrips++;
        console.log(`Tick ${tickCount}: CIRCUIT BREAKER TRIPPED (drawdown triggered).`);
      } catch (err) {
        console.log(`Tick ${tickCount}: Breaker already tripped or instruction failed.`);
      }
    }

    tickCount++;
  };

  // Drive simulation with 15s ticks
  const interval = setInterval(async () => {
    await runTick();
  }, CONFIG.tickIntervalMs);

  // Allow graceful shutdown
  process.on("SIGINT", () => {
    clearInterval(interval);
    console.log("\nSimulation stopped by user.");
    console.log(`Final stats - Breaker trips: ${breakerTrips}, False positives: ${falsePositives}`);
    process.exit(0);
  });

  // Run first tick immediately
  await runTick();
}

main().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
