import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import createLagInjector from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { PriceData, TestOracle, advanceToSlot, getVaultProgram, loadJitoPriceHistory } from "./oracle-utils";

const LAG_TARGET_SLOTS = 90; // ~45s at 0.5s/slot
const TICK_INTERVAL_MS = 15000;
const SIM_DURATION_DAYS = 7;
const SLOTS_PER_DAY = 172800; // rough 0.5s slot time

async function runSimulation() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const connection = provider.connection;
  const program = getVaultProgram(provider);

  // Owner for pause/withdraw
  const owner = Keypair.generate();
  await provider.connection.requestAirdrop(owner.publicKey, 10 * 1e9);

  const oracle = new TestOracle(Keypair.generate().publicKey);
  const lagInjector = createLagInjector(connection, oracle.pubkey, LAG_TARGET_SLOTS);

  console.log("Loading JitoSOL depeg price history...");
  const priceHistory = loadJitoPriceHistory();

  console.log(`Starting 7-day sim with ${priceHistory.length} price points...`);
  let currentSlot = 1000;
  let breakerTrips = 0;
  let falsePositives = 0;
  let tick = 0;
  const totalTicks = (SIM_DURATION_DAYS * 86400) / (TICK_INTERVAL_MS / 1000);

  while (tick < totalTicks) {
    // Inject lagged price
    const priceIndex = Math.min(tick, priceHistory.length - 1);
    const rawPrice = priceHistory[priceIndex];
    const laggedPrice: PriceData = {
      price: rawPrice * 1e9, // scale to oracle precision
      timestamp: Math.floor(Date.now() / 1000) - 45
    };

    await lagInjector.injectPrice(laggedPrice);

    // Advance validator time
    currentSlot += Math.floor(TICK_INTERVAL_MS / 500);
    await advanceToSlot(connection, currentSlot);

    // Run TWAP false-positive checker
    const isFalsePositive = checkTWAPFalsePositive(priceHistory.slice(0, priceIndex + 1), 15);
    if (isFalsePositive) {
      falsePositives++;
      console.log(`Tick ${tick}: TWAP false positive detected`);
    }

    // Check circuit breaker state on-chain
    const vaultState = await program.account.vault.fetch(oracle.pubkey); // reuse oracle key for vault PDA in sim
    if (vaultState.breakerTripped) {
      breakerTrips++;
      console.log(`Tick ${tick}: Circuit breaker TRIPPED at price ${rawPrice}`);
    }

    // Every 100 ticks simulate owner pause check
    if (tick % 100 === 0) {
      try {
        await program.methods
          .pause()
          .accounts({
            vault: oracle.pubkey,
            owner: owner.publicKey,
          })
          .signers([owner])
          .rpc();
      } catch (e) {
        // expected after first pause
      }
    }

    tick++;
    if (tick % 100 === 0) {
      console.log(`Progress: ${Math.round((tick / totalTicks) * 100)}% | Trips: ${breakerTrips} | FalsePos: ${falsePositives}`);
    }

    await new Promise(resolve => setTimeout(resolve, 10)); // yield
  }

  console.log("\n=== SIMULATION COMPLETE ===");
  console.log(`Breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / (breakerTrips || 1)) * 100).toFixed(1)}%`);
}

runSimulation().catch(console.error);
