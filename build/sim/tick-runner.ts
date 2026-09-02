import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { getHistoricalJitoPrices } from "./oracle-utils";
import { checkTWAPFalsePositive } from "./twap-checker";
import { Vault } from "../target/types/vault";

interface TWAPConfig {
  windowSlots: number;
  thresholdBps: number;
}

interface SimResult {
  breakerTrips: number;
  falsePositives: number;
  totalTicks: number;
}

async function run7DayTickSimulation(): Promise<SimResult> {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as anchor.Program<Vault>;
  const connection = provider.connection;

  const prices = getHistoricalJitoPrices();
  const injector = new LagInjector(connection, new PublicKey("11111111111111111111111111111111"));

  const config: TWAPConfig = {
    windowSlots: 150,
    thresholdBps: 500,
  };

  let breakerTrips = 0;
  let falsePositives = 0;
  const totalTicks = prices.length;

  console.log(`Starting 7-day sim with ${totalTicks} ticks (target lag: 45s)...`);

  for (let i = 0; i < prices.length; i++) {
    const price = prices[i];
    await injector.injectLag(price);

    const isFalsePositive = checkTWAPFalsePositive(prices.slice(0, i + 1), config);
    const isBreakerTrip = isFalsePositive; // In full harness this would query on-chain state

    if (isBreakerTrip) {
      breakerTrips++;
      if (isFalsePositive) falsePositives++;
      console.log(`Tick ${i}: Breaker tripped (false positive: ${isFalsePositive})`);
    }

    if ((i + 1) % 500 === 0) {
      console.log(`Progress: ${Math.round(((i + 1) / totalTicks) * 100)}%`);
    }

    // Simulate 15s tick pacing
    if (i < prices.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 15));
    }
  }

  const result: SimResult = { breakerTrips, falsePositives, totalTicks };
  console.log("\n=== Simulation Complete ===");
  console.log(`Breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log(`False positive rate: ${totalTicks > 0 ? ((falsePositives / breakerTrips) * 100).toFixed(2) : 0}%`);

  return result;
}

async function main() {
  try {
    await run7DayTickSimulation();
    process.exit(0);
  } catch (err) {
    console.error("Simulation failed:", err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { run7DayTickSimulation, TWAPConfig };
