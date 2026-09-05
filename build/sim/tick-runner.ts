import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { TWAPChecker } from "./twap-checker";
import { getHistoricalJitoPrices } from "./oracle-utils";

async function main() {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(Keypair.generate()),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const prices = getHistoricalJitoPrices();
  const lagInjector = new LagInjector(connection, new PublicKey("11111111111111111111111111111111"));
  const twapChecker = new TWAPChecker();

  console.log("Starting 7-day JitoSOL depeg simulation with 45s oracle lag...");

  const lagSeconds = 45;
  const slotMs = 400; // approximate ms per slot
  const totalTicks = 7 * 24 * 60 * 60 * 1000 / slotMs; // ~7 days in slots

  let breakerTrips = 0;
  let falsePositives = 0;
  let totalChecks = 0;

  // Replay the series with lag; each "tick" advances simulated time
  for (let tick = 0; tick < totalTicks; tick += 100) { // sample every ~40s
    const currentSlot = tick;
    const simulatedTime = Date.now() - (lagSeconds * 1000);

    lagInjector.replayWithLag(prices, lagSeconds);

    const tripped = twapChecker.checkTWAPFalsePositive(prices, currentSlot, simulatedTime);
    totalChecks++;

    if (tripped) {
      breakerTrips++;
      console.log(`[${new Date().toISOString()}] DRAW DOWN CIRCUIT BREAKER TRIPPED at slot ${currentSlot}`);
    }

    // Simple false-positive heuristic over the replay window
    if (tick % 500 === 0 && !tripped) {
      const fp = twapChecker.isFalsePositive(prices);
      if (fp) {
        falsePositives++;
        console.log(`[${new Date().toISOString()}] False positive detected at slot ${currentSlot}`);
      }
    }

    if (tick % 2000 === 0) {
      console.log(`Progress: ${Math.round((tick / totalTicks) * 100)}% - Trips: ${breakerTrips}, FalsePos: ${falsePositives}`);
    }
  }

  console.log("\n=== SIMULATION COMPLETE ===");
  console.log(`Total ticks checked: ${totalChecks}`);
  console.log(`Circuit breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log(`False positive rate: ${totalChecks > 0 ? ((falsePositives / totalChecks) * 100).toFixed(2) : 0}%`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
