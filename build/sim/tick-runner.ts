import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { LagInjector, createLagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { TestOracle, PriceData, createTestOracle, updateTestOraclePrice } from "./oracle-utils";

interface SimResult {
  breakerShouldTrip: boolean;
  isFalsePositive: boolean;
  twap: number | null;
  breakerTrips: number;
  falsePositives: number;
}

async function runTick(
  lagInjector: LagInjector,
  testOracle: TestOracle,
  currentSlot: number,
  priceSeries: PriceData[],
  lagSlots: number,
  twapWindow: number
): Promise<SimResult> {
  // Replay next price with lag
  const priceIndex = Math.floor(currentSlot / 5) % priceSeries.length;
  const priceData = priceSeries[priceIndex];
  
  await lagInjector.setPrice(priceData.price);
  await lagInjector.injectLagPrice(testOracle.pubkey, currentSlot, lagSlots);

  // Update on-chain oracle
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  await updateTestOraclePrice(connection, testOracle, priceData.price, new anchor.Wallet(Keypair.generate()));

  // Check TWAP
  const twapResult = checkTWAPFalsePositive(priceSeries, currentSlot, twapWindow);
  
  const shouldTrip = typeof twapResult === "object" ? twapResult.breakerShouldTrip : false;
  const isFalsePositive = typeof twapResult === "object" ? twapResult.isFalsePositive : false;
  const twapValue = typeof twapResult === "object" ? twapResult.twap : null;

  return {
    breakerShouldTrip: shouldTrip,
    isFalsePositive: isFalsePositive,
    twap: twapValue,
    breakerTrips: shouldTrip ? 1 : 0,
    falsePositives: isFalsePositive ? 1 : 0,
  };
}

export async function run7DaySim(
  priceSeries: PriceData[],
  lagSeconds: number = 45,
  twapSeconds: number = 15
): Promise<void> {
  console.log("Starting 7-day JitoSOL depeg simulation with lag injector...");

  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const wallet = new anchor.Wallet(Keypair.generate());
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  const testOracle = await createTestOracle(provider);
  const lagInjector = createLagInjector(provider, testOracle.pubkey);
  
  const slotDuration = 0.4; // seconds per slot
  const lagSlots = Math.floor(lagSeconds / slotDuration);
  const twapWindow = Math.floor(twapSeconds / slotDuration);
  
  const totalSlots = 7 * 24 * 60 * 60 * 2.5; // ~7 days at 2.5 slots/sec
  let breakerTrips = 0;
  let falsePositives = 0;
  let totalChecks = 0;

  console.log(`Running simulation for ${totalSlots} slots with ${lagSlots} slot lag...`);

  for (let slot = 0; slot < totalSlots; slot += 25) { // sample every 10s
    const result = await runTick(
      lagInjector,
      testOracle,
      slot,
      priceSeries,
      lagSlots,
      twapWindow
    );

    breakerTrips += result.breakerTrips;
    falsePositives += result.falsePositives;
    totalChecks++;

    if (result.breakerShouldTrip) {
      console.log(`Slot ${slot}: CIRCUIT BREAKER TRIPPED | TWAP: ${result.twap?.toFixed(4)} | FalsePositive: ${result.isFalsePositive}`);
    } else if (result.isFalsePositive) {
      console.log(`Slot ${slot}: False positive detected | TWAP: ${result.twap?.toFixed(4)}`);
    }

    // Simulate time passage
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  const falsePositiveRate = totalChecks > 0 ? (falsePositives / totalChecks) * 100 : 0;
  
  console.log("\n=== SIMULATION COMPLETE ===");
  console.log(`Total breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log(`False positive rate: ${falsePositiveRate.toFixed(2)}%`);
  console.log(`Target lag: ${lagSeconds}s (${lagSlots} slots)`);
  console.log(`TWAP window: ${twapSeconds}s (${twapWindow} slots)`);
}

async function main() {
  // Sample Jito depeg price series (simplified for test)
  const samplePriceSeries: PriceData[] = [
    { price: 1.00, confidence: 0.01, timestamp: 0 },
    { price: 0.98, confidence: 0.01, timestamp: 5 },
    { price: 0.85, confidence: 0.02, timestamp: 10 },
    { price: 0.72, confidence: 0.03, timestamp: 15 },
    { price: 0.65, confidence: 0.04, timestamp: 20 },
    { price: 0.68, confidence: 0.02, timestamp: 25 },
    { price: 0.75, confidence: 0.01, timestamp: 30 },
    { price: 0.92, confidence: 0.01, timestamp: 35 },
  ];

  await run7DaySim(samplePriceSeries, 45, 15);
}

if (require.main === module) {
  main().catch(console.error);
}

export { run7DaySim, SimResult };
