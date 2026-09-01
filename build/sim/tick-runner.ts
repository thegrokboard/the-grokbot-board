import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { createLagInjector, injectLagPrice } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createPriceAccount, updatePriceAccount, PriceData } from "./oracle-utils";
import { Vault } from "../target/types/vault";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = anchor.workspace.Vault as anchor.Program<Vault>;

const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCP");
const PYTH_ORACLE = new PublicKey("H6ARHf6YXhGYeQf49qG9U9j8v3zK3v6f7v3zK3v6f7"); // placeholder for sim
const OWNER = provider.wallet.publicKey;

async function runSim() {
  console.log("Starting pure-onchain Anchor JitoSOL depeg sim...");

  // Setup vault
  const vault = Keypair.generate();
  const protectionBuffer = Keypair.generate();
  const priceAccount = await createPriceAccount(provider.connection, provider.wallet, PYTH_ORACLE);

  await program.methods
    .initialize(new anchor.BN(1000), new anchor.BN(500))
    .accounts({
      vault: vault.publicKey,
      owner: OWNER,
      jitoMint: JITO_SOL_MINT,
      protectionBuffer: protectionBuffer.publicKey,
      priceAccount: priceAccount,
      systemProgram: SystemProgram.programId,
    })
    .signers([vault, protectionBuffer])
    .rpc();

  console.log("Vault initialized at", vault.publicKey.toBase58());

  const lagInjector = createLagInjector(provider.connection, PYTH_ORACLE, 45);
  const series = [
    { price: 0.95, confidence: 0.01, timestamp: Date.now() / 1000, slot: 100 },
    { price: 0.85, confidence: 0.02, timestamp: Date.now() / 1000 + 5, slot: 105 },
    { price: 0.75, confidence: 0.03, timestamp: Date.now() / 1000 + 10, slot: 110 },
  ] as PriceData[];

  let breakerTrips = 0;
  let falsePositives = 0;

  for (let i = 0; i < series.length; i++) {
    const data = series[i];
    await injectLagPrice(lagInjector, priceAccount, data, provider.wallet);

    const isFalsePositive = await checkTWAPFalsePositive(
      provider.connection,
      priceAccount,
      15
    );

    if (isFalsePositive) {
      falsePositives++;
      console.log(`False positive detected at tick ${i}`);
    } else if (data.price < 0.8) {
      // Simulate drawdown breaker trip
      try {
        await program.methods
          .triggerDrawdown()
          .accounts({
            vault: vault.publicKey,
            owner: OWNER,
            priceAccount: priceAccount,
          })
          .rpc();
        breakerTrips++;
        console.log(`Breaker tripped at price ${data.price}`);
      } catch (e) {
        console.log("Breaker already tripped or other error");
      }
    }
  }

  console.log("\n=== SIM RESULTS ===");
  console.log(`Breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log("Sim completed.");
}

runSim().catch(console.error);
