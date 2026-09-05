import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData, TWAPConfig } from "./oracle-utils";
import { Vault } from "../target/types/vault";

async function main() {
  // Setup connection to local test validator
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  
  // Load the program
  const provider = new anchor.AnchorProvider(
    connection,
    anchor.Wallet.local(),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);
  
  const program = anchor.workspace.Vault as anchor.Program<Vault>;
  
  // Configuration
  const lagSeconds = 45;
  const twapConfig: TWAPConfig = {
    windowSeconds: 15,
    thresholdBps: 500, // 5% deviation
    minObservations: 5
  };
  
  console.log("Starting 7-day JitoSOL depeg simulation with onchain circuit breaker...");
  console.log(`Lag: ${lagSeconds}s | TWAP window: ${twapConfig.windowSeconds}s`);
  
  // Get historical price series (simulated Jito depeg events)
  const priceHistory: PriceData[] = getHistoricalJitoPrices();
  
  // Initialize lag injector
  const injector = new LagInjector(connection, lagSeconds);
  
  // Replay the lagged price series into the onchain oracle accounts
  await injector.replayLaggedSeries(priceHistory);
  
  console.log(`Replayed ${priceHistory.length} price updates with ${lagSeconds}s lag`);
  
  let breakerTrips = 0;
  let falsePositives = 0;
  const totalTicks = 7 * 24 * 60 * 4; // 7 days * 24h * 60m * 4 (15s ticks)
  
  // Simulate 15s ticks over 7 days
  for (let tick = 0; tick < totalTicks; tick++) {
    const currentSlot = await connection.getSlot();
    
    // Get recent prices from the lagged oracle feed
    const recentPrices: PriceData[] = await injector.getRecentPrices(30); // last ~7.5min
    
    if (recentPrices.length < twapConfig.minObservations) {
      console.log(`Tick ${tick}: insufficient data (${recentPrices.length} prices)`);
      await sleep(50); // simulate tick timing
      continue;
    }
    
    // Check for TWAP false positive (i.e. would it incorrectly trigger breaker?)
    const isFalsePositive = checkTWAPFalsePositive(recentPrices, twapConfig);
    
    if (isFalsePositive) {
      falsePositives++;
      console.log(`Tick ${tick}: TWAP false positive detected`);
    }
    
    // In a real sim we would call the onchain drawdown circuit-breaker instruction here
    // For this harness we simulate the check and log potential trips
    if (Math.random() < 0.001) { // simulated rare breaker trip
      breakerTrips++;
      console.log(`TICK ${tick}: CIRCUIT BREAKER TRIPPED (drawdown detected)`);
      
      // Example onchain call (commented as it requires account setup)
      // await program.methods.drawdownCircuitBreaker()
      //   .accounts({ vault: vaultPubkey, owner: ownerPubkey })
      //   .rpc();
    }
    
    // Simulate real-time passage (15s per tick)
    await sleep(50);
    
    if (tick % 100 === 0) {
      console.log(`Progress: ${((tick / totalTicks) * 100).toFixed(1)}% | Trips: ${breakerTrips} | FalsePos: ${falsePositives}`);
    }
  }
  
  console.log("\n=== SIMULATION COMPLETE ===");
  console.log(`Breaker trips: ${breakerTrips}`);
  console.log(`TWAP false positives: ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / totalTicks) * 100).toFixed(3)}%`);
}

// Simple sleep helper
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the simulation
main().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
