import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import { createLagInjector, injectLagPrice } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createPriceAccount, updatePriceAccount, PriceData } from "./oracle-utils";

const JITO_SOL_MINT = new PublicKey("J1toso1uckeCBxdeHfG1sK5Wv9z5y2v7z2z2z2z2z2"); // placeholder
const PYTH_ORACLE_PROGRAM = new PublicKey("FsJ3A3u2vn5cTVofAjv5j7YQ4vKqN7g3jF5z5z5z5z5"); // placeholder
const PYTH_PRICE_FEED = new PublicKey("11111111111111111111111111111111"); // placeholder for sim

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Vault as anchor.Program<Vault>;

  const owner = provider.wallet;
  const vault = Keypair.generate();
  const protectionBuffer = Keypair.generate();
  const oracleAccount = await createPriceAccount(provider.connection, owner.payer, PYTH_ORACLE_PROGRAM);

  console.log("Initializing vault...");
  await program.methods
    .initialize(new anchor.BN(1000), new anchor.BN(500))
    .accounts({
      vault: vault.publicKey,
      owner: owner.publicKey,
      protectionBuffer: protectionBuffer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([vault, protectionBuffer])
    .rpc();

  const lagInjector = createLagInjector(provider.connection, oracleAccount, 45);

  // Replay last three Jito depeg price series (simplified historical data)
  const priceSeries: PriceData[] = [
    { price: 0.92, confidence: 0.01, timestamp: Date.now() / 1000, slot: 100 },
    { price: 0.85, confidence: 0.02, timestamp: Date.now() / 1000 + 5, slot: 105 },
    { price: 0.78, confidence: 0.03, timestamp: Date.now() / 1000 + 10, slot: 110 },
  ];

  console.log("Injecting lagged prices...");
  for (const pd of priceSeries) {
    await injectLagPrice(lagInjector, pd);
  }

  console.log("Checking 15s TWAP false-positive...");
  const isFalsePositive = await checkTWAPFalsePositive(
    provider.connection,
    oracleAccount,
    new anchor.BN(15)
  );
  console.log("Is false positive:", isFalsePositive);

  // 7-day tick runner simulation (placeholder for full 7d run)
  console.log("Starting 7-day tick simulation (dry-run mode)...");
  for (let tick = 0; tick < 5; tick++) {  // small for CI speed
    const currentSlot = 100 + tick * 10;
    const currentPrice: PriceData = {
      price: 0.9 - (tick * 0.03),
      confidence: 0.015,
      timestamp: Date.now() / 1000 + tick * 15,
      slot: currentSlot,
    };

    await updatePriceAccount(provider.connection, owner.payer, oracleAccount, currentPrice);

    const tripped = await program.methods
      .checkDrawdown()
      .accounts({
        vault: vault.publicKey,
        priceOracle: oracleAccount,
      })
      .rpc()
      .then(() => false)
      .catch((e) => {
        console.log("Breaker tripped on tick", tick, e.message);
        return true;
      });

    const fp = await checkTWAPFalsePositive(
      provider.connection,
      oracleAccount,
      new anchor.BN(15)
    );

    console.log(`Tick ${tick}: breaker=${tripped}, falsePositive=${fp}`);
  }

  console.log("Simulation complete. Breaker trips vs false positives logged.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
