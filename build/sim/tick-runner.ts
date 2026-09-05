import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { LagInjector, LagInjectorConfig, PriceData } from "./lag-injector";
import { getHistoricalJitoPrices } from "./oracle-utils";
import { checkTWAPFalsePositive, TWAPConfig } from "./twap-checker";
import { Vault } from "../target/types/vault";

interface SimResult {
  breakerTrips: number;
  falsePositives: number;
  totalTicks: number;
  log: string[];
}

async function run7DaySim(): Promise<SimResult> {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const wallet = Keypair.generate();
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {});
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as anchor.Program<Vault>;

  // Load historical JitoSOL price series (last 7 days worth at 15s granularity)
  const historicalPrices: PriceData[] = getHistoricalJitoPrices();

  const lagConfig: LagInjectorConfig = {
    lagSeconds: 45,
    slotDurationMs: 400,
  };

  const injector = new LagInjector(historicalPrices, lagConfig);

  const twapConfig: TWAPConfig = {
    windowSlots: 120, // 15s * 8 slots per second approx, but using slot count for 15s TWAP
    thresholdBps: 500, // 5% drawdown
  };

  let breakerTrips = 0;
  let falsePositives = 0;
  let totalTicks = 0;
  const logs: string[] = [];

  logs.push("=== JitoSOL Depeg Protection Sim (7-day tick replay) ===");
  logs.push(`Lag target: ${lagConfig.lagSeconds}s | TWAP window: ${twapConfig.windowSlots} slots`);
  logs.push(`Historical prices loaded: ${historicalPrices.length}\n`);

  // Replay each price point as a new slot
  for (let i = 0; i < historicalPrices.length; i++) {
    const currentSlot = 1000 + i; // arbitrary starting slot
    const pricePoint = historicalPrices[i];

    // Inject lagged price into on-chain oracle account
    injector.injectPriceAtSlot(currentSlot, pricePoint);

    // Get current on-chain view (lagged)
    const currentPrice = injector.getCurrentPrice(currentSlot);

    // Run TWAP check (simulates on-chain circuit breaker logic)
    const isFalsePositive = checkTWAPFalsePositive(
      injector.getPriceHistory(),
      currentPrice,
      twapConfig
    );

    totalTicks++;

    if (isFalsePositive) {
      falsePositives++;
      logs.push(`[${currentSlot}] TWAP FALSE POSITIVE @ $${currentPrice.price.toFixed(4)}`);
    } else if (currentPrice.price < 0.95) { // simplistic trip condition for demo
      breakerTrips++;
      logs.push(`[${currentSlot}] BREAKER TRIPPED @ $${currentPrice.price.toFixed(4)}`);
    }

    // Every 240 ticks (~1 hour) emit status
    if (totalTicks % 240 === 0) {
      logs.push(`Progress: ${Math.round((i / historicalPrices.length) * 100)}% | Trips: ${breakerTrips} | FP: ${falsePositives}`);
    }
  }

  logs.push("\n=== SIM COMPLETE ===");
  logs.push(`Total ticks: ${totalTicks}`);
  logs.push(`Circuit breaker trips: ${breakerTrips}`);
  logs.push(`False positives (15s TWAP): ${falsePositives}`);
  logs.push(`False positive rate: ${((falsePositives / totalTicks) * 100).toFixed(2)}%`);

  return {
    breakerTrips,
    falsePositives,
    totalTicks,
    log: logs,
  };
}

// CLI entrypoint
if (require.main === module) {
  run7DaySim()
    .then((result) => {
      result.log.forEach((line) => console.log(line));
      if (result.falsePositives > result.breakerTrips * 2) {
        console.log("\n⚠️  High false-positive rate detected in sim");
        process.exit(1);
      }
      console.log("\n✅ Sim completed successfully");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Sim failed:", err);
      process.exit(1);
    });
}

export { run7DaySim, SimResult };
