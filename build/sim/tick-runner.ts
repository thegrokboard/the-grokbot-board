import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices } from "./oracle-utils";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";

interface SimConfig {
  lagSeconds: number;
  twapWindowSeconds: number;
  falsePositiveThreshold: number;
  replayDays: number;
  oraclePubkey: PublicKey;
  jitoSolMint: PublicKey;
}

const DEFAULT_CONFIG: SimConfig = {
  lagSeconds: 45,
  twapWindowSeconds: 15,
  falsePositiveThreshold: 0.02,
  replayDays: 7,
  oraclePubkey: new PublicKey("4v25K7x9f8v2p8z3m4n5b6v7c8x9y0z1a2b3c4d5e6f"), // placeholder
  jitoSolMint: new PublicKey("J1toso1uCk3RLmP4mYb9cY5d1b5a5f5e5d5c5b5a5f"), // placeholder
};

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program<Vault>(
    require("../target/idl/vault.json"),
    provider
  );

  const config = DEFAULT_CONFIG;
  console.log("Starting 7-day JitoSOL depeg simulation with", config.lagSeconds, "s oracle lag");

  // Load historical price series (last replayDays worth of data)
  const historicalSeries = await getHistoricalJitoPrices(config.replayDays);
  console.log(`Loaded ${historicalSeries.length} historical price points`);

  const lagInjector = new LagInjector({
    lagSeconds: config.lagSeconds,
    connection: provider.connection,
    oraclePubkey: config.oraclePubkey,
    historicalSeries,
  });

  await lagInjector.initialize();

  let breakerTrips = 0;
  let falsePositives = 0;
  let totalTicks = 0;

  const startSlot = await provider.connection.getSlot();
  const endSlot = startSlot + (config.replayDays * 24 * 60 * 6); // ~6 slots per minute

  for (let slot = startSlot; slot < endSlot; slot += 6) { // 10s ticks
    totalTicks++;

    // Inject lagged price
    await lagInjector.injectPriceAtSlot(slot);

    const currentPrice = lagInjector.getCurrentPrice();
    const priceHistory = lagInjector.getPriceHistory(config.twapWindowSeconds);

    if (priceHistory.length === 0) continue;

    // Check for drawdown circuit breaker trip
    const drawdown = (priceHistory[0].price - currentPrice.price) / priceHistory[0].price;
    const isBreakerTrip = drawdown > 0.05; // 5% drawdown example threshold

    if (isBreakerTrip) {
      breakerTrips++;
      console.log(`[${slot}] Breaker TRIPPED - drawdown: ${(drawdown * 100).toFixed(2)}%`);

      // Call on-chain drawdown circuit-breaker instruction
      try {
        await program.methods
          .triggerCircuitBreaker()
          .accounts({
            vault: new PublicKey("Vault111111111111111111111111111111111111111"),
            owner: provider.wallet.publicKey,
            oracle: config.oraclePubkey,
          })
          .rpc();
      } catch (e) {
        console.error("On-chain breaker call failed (expected in sim):", e.message);
      }
    }

    // Run 15s TWAP false-positive checker
    const isFalsePositive = checkTWAPFalsePositive(
      priceHistory,
      currentPrice,
      config.twapWindowSeconds,
      config.falsePositiveThreshold
    );

    if (isFalsePositive) {
      falsePositives++;
      console.log(`[${slot}] False positive detected by 15s TWAP`);
    }

    if (totalTicks % 100 === 0) {
      console.log(`Progress: ${totalTicks} ticks | Breaker trips: ${breakerTrips} | False positives: ${falsePositives}`);
    }
  }

  const tripRate = ((breakerTrips / totalTicks) * 100).toFixed(2);
  const fpRate = ((falsePositives / totalTicks) * 100).toFixed(2);

  console.log("\n=== Simulation Complete ===");
  console.log(`Total ticks: ${totalTicks}`);
  console.log(`Circuit breaker trips: ${breakerTrips} (${tripRate}%)`);
  console.log(`TWAP false positives: ${falsePositives} (${fpRate}%)`);
  console.log("Pure on-chain Anchor vault sim completed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
