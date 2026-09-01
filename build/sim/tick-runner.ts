import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createLagInjector, LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createTestOracle, updateTestOracle, PriceData, TestOracle } from "./oracle-utils";
import { Vault } from "../target/types/vault";

const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn");
const DEFAULT_LAG_SLOTS = 135; // ~45s at 333ms/slot
const TICK_INTERVAL_MS = 15000;
const SIM_DAYS = 7;
const SLOTS_PER_DAY = 24 * 60 * 60 * 2; // ~2 slots/sec

export async function run7DaySim(provider: anchor.AnchorProvider, oracleLagSlots: number = DEFAULT_LAG_SLOTS): Promise<{
  breakerTrips: number;
  falsePositives: number;
  log: string[];
}> {
  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;

  // Setup test oracle
  const oracleKp = Keypair.generate();
  const oraclePubkey = await createTestOracle(connection, wallet.payer, oracleKp);

  const testOracle: TestOracle = {
    publicKey: oraclePubkey,
    keypair: oracleKp,
  };

  // Create lag injector
  const lagInjector: LagInjector = createLagInjector(connection, testOracle, oracleLagSlots);

  // Load the vault program
  const program = anchor.workspace.Vault as anchor.Program<Vault>;

  // Create vault account (minimal for sim)
  const vaultKp = Keypair.generate();
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), vaultKp.publicKey.toBuffer()],
    program.programId
  );

  // Initialize vault (owner = payer)
  await program.methods
    .initialize()
    .accounts({
      vault: vaultPda,
      owner: wallet.publicKey,
      jitoSolMint: JITO_SOL_MINT,
      testOracle: testOracle.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([vaultKp])
    .rpc();

  const log: string[] = [];
  let breakerTrips = 0;
  let falsePositives = 0;
  let currentSlot = 0;
  const totalTicks = (SIM_DAYS * 86400) / 15; // 15s ticks

  log.push(`Starting 7-day sim with ${oracleLagSlots} slot lag (${totalTicks} ticks)`);

  // Replay last three Jito depeg price series (simplified synthetic for onchain test)
  const priceSeries: PriceData[] = generateDepegSeries();

  for (let tick = 0; tick < totalTicks; tick++) {
    const price = priceSeries[tick % priceSeries.length];
    const slot = currentSlot++;

    // Inject lagged price
    await lagInjector.injectLagPrice(price, slot);

    // Update oracle with current (real) price for TWAP baseline
    await updateTestOracle(connection, wallet.payer, testOracle.publicKey, price.price, slot);

    // Run 15s TWAP false-positive check
    const twapResult = await checkTWAPFalsePositive(
      connection,
      testOracle.publicKey,
      price.price,
      15 // 15s window
    );

    if (twapResult === null) {
      log.push(`Tick ${tick}: TWAP check failed to compute`);
      continue;
    }

    const isFalsePositive = twapResult.isFalsePositive;
    const shouldTrip = twapResult.shouldTrip;

    if (shouldTrip) {
      breakerTrips++;
      // Simulate drawdown circuit-breaker instruction
      try {
        await program.methods
          .triggerDrawdown()
          .accounts({
            vault: vaultPda,
            owner: wallet.publicKey,
            testOracle: testOracle.publicKey,
          })
          .rpc();
        log.push(`Tick ${tick} (slot ${slot}): BREAKER TRIPPED at price ${price.price}`);
      } catch (e) {
        log.push(`Tick ${tick}: breaker tx failed - ${e}`);
      }
    } else if (isFalsePositive) {
      falsePositives++;
      log.push(`Tick ${tick} (slot ${slot}): false positive at price ${price.price}`);
    }

    if (tick % 100 === 0) {
      log.push(`Progress: ${Math.round((tick / totalTicks) * 100)}% - trips: ${breakerTrips}, falsePos: ${falsePositives}`);
    }

    // Simulate time passage
    await new Promise((resolve) => setTimeout(resolve, 10)); // fast-forward sim
  }

  log.push(`Simulation complete. Breaker trips: ${breakerTrips}, False positives: ${falsePositives}`);
  return { breakerTrips, falsePositives, log };
}

function generateDepegSeries(): PriceData[] {
  const series: PriceData[] = [];
  // Synthetic JitoSOL depeg replay (3 historical-style drops)
  const basePrice = 0.92;
  for (let i = 0; i < 200; i++) {
    series.push({ price: basePrice + Math.sin(i / 10) * 0.03 });
  }
  // Depeg 1
  for (let i = 0; i < 80; i++) {
    series.push({ price: 0.85 - i * 0.002 });
  }
  // Recovery
  for (let i = 0; i < 120; i++) {
    series.push({ price: 0.75 + i * 0.003 });
  }
  // Depeg 2 + 3 (truncated for test)
  for (let i = 0; i < 300; i++) {
    series.push({ price: 0.88 + Math.random() * 0.05 - 0.03 });
  }
  return series;
}

// CLI entrypoint
if (require.main === module) {
  (async () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    console.log("Running 7-day onchain JitoSOL vault sim...");
    const result = await run7DaySim(provider, 135);
    result.log.forEach((line) => console.log(line));
    console.log(`\nSummary: ${result.breakerTrips} trips, ${result.falsePositives} false positives`);
    process.exit(0);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
