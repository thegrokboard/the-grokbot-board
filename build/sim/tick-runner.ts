import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createLagInjector, LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createTestOracle, PriceData } from "./oracle-utils";
import { Vault } from "../target/types/vault";

interface SimulationResult {
  isFalsePositive: boolean;
  shouldTrip: boolean;
  breakerTrips: number;
  falsePositives: number;
}

export async function runTick(
  connection: Connection,
  injector: LagInjector,
  oracle: { pubkey: PublicKey },
  priceSeries: PriceData[],
  tick: number,
  breakerState: { tripped: boolean }
): Promise<SimulationResult> {
  const currentPrice = priceSeries[tick % priceSeries.length];
  await injector.setPrice(connection, oracle.pubkey, currentPrice);

  const lagPrice = await injector.injectLagPrice(connection, oracle.pubkey, 45);
  
  const checkResult = checkTWAPFalsePositive(
    priceSeries.slice(0, tick + 1),
    lagPrice,
    15
  );

  const shouldTrip = checkResult.shouldTrip && !breakerState.tripped;
  if (shouldTrip) {
    breakerState.tripped = true;
  }

  return {
    isFalsePositive: checkResult.isFalsePositive,
    shouldTrip,
    breakerTrips: shouldTrip ? 1 : 0,
    falsePositives: checkResult.isFalsePositive ? 1 : 0,
  };
}

export async function run7DaySimulation(): Promise<void> {
  console.log("Starting 7-day JitoSOL depeg protection sim...");

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as anchor.Program<Vault>;
  const connection = provider.connection;

  const owner = Keypair.generate();
  await connection.confirmTransaction(
    await connection.requestAirdrop(owner.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL)
  );

  const oracle = await createTestOracle(connection, owner);
  const injector = createLagInjector(program, owner);

  // Sample depeg price series (last three Jito depegs approximated)
  const priceSeries: PriceData[] = [
    { price: 0.98, conf: 0.01, slot: 100 },
    { price: 0.95, conf: 0.02, slot: 110 },
    { price: 0.85, conf: 0.05, slot: 120 },
    { price: 0.75, conf: 0.08, slot: 130 },
    { price: 0.92, conf: 0.03, slot: 200 },
    { price: 0.88, conf: 0.04, slot: 210 },
    { price: 0.82, conf: 0.06, slot: 220 },
    { price: 0.79, conf: 0.07, slot: 230 },
    { price: 0.96, conf: 0.02, slot: 300 },
    { price: 0.94, conf: 0.02, slot: 310 },
    { price: 0.90, conf: 0.03, slot: 320 },
    { price: 0.87, conf: 0.04, slot: 330 },
  ];

  const breakerState = { tripped: false };
  let totalBreakerTrips = 0;
  let totalFalsePositives = 0;
  const ticks = 7 * 24 * 60 * 4; // ~15s ticks over 7 days

  console.log(`Running ${ticks} ticks...`);

  for (let tick = 0; tick < ticks; tick++) {
    const result = await runTick(
      connection,
      injector,
      oracle,
      priceSeries,
      tick,
      breakerState
    );

    totalBreakerTrips += result.breakerTrips;
    totalFalsePositives += result.falsePositives;

    if (tick % 100 === 0) {
      console.log(`Tick ${tick}: trip=${result.shouldTrip}, fp=${result.isFalsePositive}`);
    }
  }

  console.log("\nSimulation complete:");
  console.log(`Breaker trips: ${totalBreakerTrips}`);
  console.log(`False positives: ${totalFalsePositives}`);
  console.log(`Final breaker state: ${breakerState.tripped ? "TRIPPED" : "OK"}`);
}

if (require.main === module) {
  run7DaySimulation().catch(console.error);
}
