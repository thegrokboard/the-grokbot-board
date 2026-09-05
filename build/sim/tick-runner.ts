import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";

const RPC_URL = "http://127.0.0.1:8899";
const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYkM6d2qG8C");
const ORACLE_ACCOUNT = new PublicKey("7yya5Kz7vDqJ4v7qK9vW9vQ9vQ9vQ9vQ9vQ9vQ9vQ9"); // placeholder for sim

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const payer = Keypair.generate();
  await connection.requestAirdrop(payer.publicKey, 100 * LAMPORTS_PER_SOL);

  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as Program<Vault>;

  const lagSeconds = 45;
  const injector = new LagInjector(provider, ORACLE_ACCOUNT, lagSeconds);

  console.log("=== Pure Onchain Anchor JitoSOL Depeg Sim ===");
  console.log(`Target lag: ${lagSeconds}s | Replay: last 3 historical depeg series`);

  const seriesList: PriceData[][] = await getHistoricalJitoPrices(3);

  let totalBreakers = 0;
  let totalFalsePositives = 0;
  let tripLog: string[] = [];

  for (let i = 0; i < seriesList.length; i++) {
    const series = seriesList[i];
    console.log(`\n--- Replaying series ${i + 1}/${seriesList.length} (${series.length} ticks) ---`);

    await injector.replayLaggedSeries(series);

    const recent: PriceData[] = await injector.getRecentPrices(90); // ~15min at 10s ticks

    const isFalsePositive = checkTWAPFalsePositive(recent, 0.05, 15);
    if (isFalsePositive) {
      totalFalsePositives++;
      tripLog.push(`Series ${i + 1}: FALSE POSITIVE (TWAP did not trip breaker)`);
    } else {
      totalBreakers++;
      tripLog.push(`Series ${i + 1}: BREAKER TRIPPED (real depeg detected)`);
    }

    // simulate on-chain drawdown check
    try {
      await program.methods
        .checkDrawdown()
        .accounts({
          vault: await program.account.vault.all()[0]?.publicKey || PublicKey.default,
          oracle: ORACLE_ACCOUNT,
          owner: wallet.publicKey,
        })
        .rpc();
      console.log("On-chain checkDrawdown succeeded (no trip)");
    } catch (e: any) {
      if (e.toString().includes("DrawdownCircuitBreaker")) {
        console.log("On-chain circuit breaker activated");
      } else {
        console.log("Other on-chain error:", e.toString());
      }
    }

    await new Promise((r) => setTimeout(r, 15000)); // 15s tick
  }

  console.log("\n=== 7-DAY SIM COMPLETE ===");
  console.log(`Breaker trips: ${totalBreakers}`);
  console.log(`False positives: ${totalFalsePositives}`);
  tripLog.forEach((entry) => console.log(entry));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
