import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";

// Simulation parameters
const LAG_SECONDS = 45;
const TICK_INTERVAL_MS = 15000; // 15s TWAP check
const TOTAL_TICKS = 7 * 24 * 60 * 4; // 7 days at 15s ticks (~4032)
const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn");

async function main() {
  // Setup Anchor provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program<Vault>(
    require("../target/idl/vault.json"),
    provider
  );

  console.log("🚀 Starting pure-onchain Anchor JitoSOL depeg sim harness");
  console.log(`Target lag: ${LAG_SECONDS}s | TWAP tick: ${TICK_INTERVAL_MS}ms | Total ticks: ${TOTAL_TICKS}`);

  // Load historical price series (last three Jito depeg events)
  const priceSeries: PriceData[] = getHistoricalJitoPrices();
  console.log(`Loaded ${priceSeries.length} historical price points from 3 depeg events`);

  // Create lag injector (replays series with configurable oracle lag)
  const lagInjector = new LagInjector(
    provider.connection,
    priceSeries,
    LAG_SECONDS
  );

  // Setup test accounts
  const owner = provider.wallet.payer;
  const vault = Keypair.generate();
  const protectionBuffer = Keypair.generate();
  const jitoStakePool = new PublicKey("JitoStakePool111111111111111111111111111111111");

  // Initialize the vault program (minimal on-chain state)
  console.log("Initializing vault program...");
  try {
    await program.methods
      .initialize()
      .accounts({
        vault: vault.publicKey,
        owner: owner.publicKey,
        protectionBuffer: protectionBuffer.publicKey,
        jitoSolMint: JITO_SOL_MINT,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([vault, protectionBuffer])
      .rpc();
    console.log("✅ Vault initialized successfully");
  } catch (e) {
    console.error("Init failed (already initialized?):", e.message);
  }

  // Start the 15s tick simulation loop
  console.log("\nStarting 7-day simulation with lagged oracle replay...");
  let tick = 0;
  let breakerTrips = 0;
  let falsePositives = 0;
  let lastPrice: number | null = null;

  const interval = setInterval(async () => {
    tick++;
    const progress = ((tick / TOTAL_TICKS) * 100).toFixed(1);

    try {
      // Inject lagged prices into the local test validator oracle account
      const currentLaggedPrice = await lagInjector.replayLaggedSeries(tick);
      
      if (currentLaggedPrice !== null) {
        if (lastPrice !== null) {
          const priceDrop = lastPrice > 0 ? (lastPrice - currentLaggedPrice) / lastPrice : 0;
          
          // Run the 15s TWAP false-positive checker
          const isFalsePositive = checkTWAPFalsePositive(
            lagInjector.getRecentPrices(),
            currentLaggedPrice,
            0.15 // 15% drawdown threshold
          );

          if (priceDrop > 0.15) {
            if (isFalsePositive) {
              falsePositives++;
              console.log(`⏰ Tick ${tick} [${progress}%] | Price: $${currentLaggedPrice.toFixed(4)} | FALSE POSITIVE (TWAP safe)`);
            } else {
              breakerTrips++;
              console.log(`🚨 Tick ${tick} [${progress}%] | Price: $${currentLaggedPrice.toFixed(4)} | DRAW DOWN DETECTED - Circuit breaker TRIPPED`);

              // Call on-chain drawdown circuit-breaker instruction
              try {
                await program.methods
                  .triggerCircuitBreaker()
                  .accounts({
                    vault: vault.publicKey,
                    owner: owner.publicKey,
                    protectionBuffer: protectionBuffer.publicKey,
                    oracle: lagInjector.getOracleAccount(),
                  })
                  .rpc();
                console.log("   └─ On-chain breaker instruction executed");
              } catch (err) {
                console.log("   └─ Breaker already triggered or paused");
              }
            }
          } else if (currentLaggedPrice > 0) {
            console.log(`✅ Tick ${tick} [${progress}%] | Price: $${currentLaggedPrice.toFixed(4)} | Normal`);
          }
        }
        lastPrice = currentLaggedPrice;
      }

      // Owner can pause and withdraw after breaker trip
      if (breakerTrips > 0 && tick % 10 === 0) {
        try {
          await program.methods
            .ownerPauseAndWithdraw()
            .accounts({
              vault: vault.publicKey,
              owner: owner.publicKey,
              protectionBuffer: protectionBuffer.publicKey,
            })
            .rpc();
          console.log("   └─ Owner pause+withdraw executed");
        } catch (_) {}
      }

      if (tick >= TOTAL_TICKS) {
        clearInterval(interval);
        console.log("\n🎉 Simulation complete!");
        console.log(`Breaker trips: ${breakerTrips} | False positives: ${falsePositives}`);
        console.log(`False positive rate: ${((falsePositives / (breakerTrips + falsePositives)) * 100 || 0).toFixed(1)}%`);
        process.exit(0);
      }
    } catch (err) {
      console.error(`Error at tick ${tick}:`, err.message);
    }
  }, TICK_INTERVAL_MS);

  // Keep process alive
  process.on("SIGINT", () => {
    console.log("\nSimulation interrupted by user");
    clearInterval(interval);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
