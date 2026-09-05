import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import { LagInjector, HistoricalPriceSeries, OracleConfig } from "./lag-injector";
import { getHistoricalPriceSeries } from "./oracle-utils";
import { checkTWAPFalsePositive } from "./twap-checker";

const LAG_TARGET_SLOTS = 150; // ~45s at 300ms/slot
const TICK_INTERVAL_MS = 15000; // 15s ticks for TWAP check
const SIM_DAYS = 7;
const TICKS_PER_DAY = (24 * 3600 * 1000) / TICK_INTERVAL_MS;
const TOTAL_TICKS = SIM_DAYS * TICKS_PER_DAY;

async function main() {
  // Setup provider
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const wallet = new Wallet(Keypair.generate()); // funded by test validator in practice
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const programId = new PublicKey("Vault111111111111111111111111111111111111111");
  const program = new Program<Vault>(programId, provider);

  // Setup vault accounts (minimal for sim)
  const vault = Keypair.generate();
  const protectionBuffer = Keypair.generate();
  const jitoMint = new PublicKey("JitoSOL111111111111111111111111111111111");

  console.log("Initializing vault for simulation...");
  await program.methods
    .initialize(new anchor.BN(1000)) // buffer threshold example
    .accounts({
      vault: vault.publicKey,
      protectionBuffer: protectionBuffer.publicKey,
      owner: wallet.publicKey,
      jitoMint,
      systemProgram: SystemProgram.programId,
    })
    .signers([vault, protectionBuffer])
    .rpc();

  // Oracle config with lag
  const oracleConfig: OracleConfig = {
    oraclePubkey: new PublicKey("Oracle1111111111111111111111111111111111111"),
    lagSlots: LAG_TARGET_SLOTS,
    basePrice: 1.0,
  };

  const lagInjector = new LagInjector(provider.connection, oracleConfig);

  // Replay last three Jito depeg series
  console.log("Fetching historical JitoSOL price series...");
  const series1 = await getHistoricalPriceSeries("jito-depeg-1");
  const series2 = await getHistoricalPriceSeries("jito-depeg-2");
  const series3 = await getHistoricalPriceSeries("jito-depeg-3");
  const allSeries: HistoricalPriceSeries[] = [series1, series2, series3];

  let breakerTrips = 0;
  let falsePositives = 0;
  let tick = 0;

  console.log(`Starting ${SIM_DAYS}-day simulation with ${TOTAL_TICKS} ticks...`);

  for (const priceSeries of allSeries) {
    await lagInjector.injectSeries(priceSeries);

    for (let i = 0; i < priceSeries.length; i += Math.floor(priceSeries.length / TICKS_PER_DAY)) {
      if (tick >= TOTAL_TICKS) break;

      const currentPrice = priceSeries[i];
      const timestamp = Date.now() / 1000;

      // Simulate on-chain price update with lag
      await lagInjector.updateOracleWithLag(currentPrice, new anchor.BN(timestamp));

      // Run 15s TWAP false-positive checker
      const isFalsePositive = checkTWAPFalsePositive(
        priceSeries.slice(0, i + 1),
        15,
        0.05 // 5% drawdown threshold
      );

      if (isFalsePositive) {
        falsePositives++;
        console.log(`Tick ${tick}: TWAP false positive detected`);
      }

      // Check circuit breaker on-chain
      try {
        await program.methods
          .checkDrawdown()
          .accounts({
            vault: vault.publicKey,
            protectionBuffer: protectionBuffer.publicKey,
            oracle: oracleConfig.oraclePubkey,
          })
          .rpc();
        console.log(`Tick ${tick}: No breaker trip`);
      } catch (err: any) {
        if (err.toString().includes("DrawdownBreached")) {
          breakerTrips++;
          console.log(`Tick ${tick}: BREAKER TRIPPED`);
        }
      }

      tick++;
      // Simulate tick interval
      await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS / 10)); // speed up sim
    }
  }

  console.log("\nSimulation complete!");
  console.log(`Breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / (breakerTrips || 1)) * 100).toFixed(2)}%`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
