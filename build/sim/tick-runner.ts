import * as anchor from "@coral-xyz/anchor";
import { Program, Wallet, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createPriceAccount, updatePriceAccount, PriceData, OracleConfig } from "./oracle-utils";
import { createLagInjector, LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { Vault } from "../target/types/vault";

async function main() {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as Program<Vault>;
  const wallet = provider.wallet as Wallet;

  const connection = provider.connection;

  // Fund wallet if needed
  const balance = await connection.getBalance(wallet.publicKey);
  if (balance < 5 * LAMPORTS_PER_SOL) {
    const airdropTx = await connection.requestAirdrop(wallet.publicKey, 5 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdropTx);
  }

  const oracleKeypair = Keypair.generate();
  const oraclePubkey = oracleKeypair.publicKey;

  const oracleConfig: OracleConfig = {
    feedPubkey: oraclePubkey,
    admin: wallet.publicKey,
    decimals: 9,
  };

  await createPriceAccount(connection, oracleKeypair, oracleConfig, wallet.payer);

  const lagInjector: LagInjector = createLagInjector(connection, oraclePubkey, wallet.payer);

  const priceHistory: PriceData[] = [
    { price: 0.95, confidence: 0.01, timestamp: Date.now() - 300000 },
    { price: 0.92, confidence: 0.015, timestamp: Date.now() - 240000 },
    { price: 0.88, confidence: 0.02, timestamp: Date.now() - 180000 },
    { price: 0.85, confidence: 0.025, timestamp: Date.now() - 120000 },
    { price: 0.82, confidence: 0.03, timestamp: Date.now() - 60000 },
    { price: 0.78, confidence: 0.035, timestamp: Date.now() },
  ];

  console.log("Starting pure-onchain Anchor JitoSOL depeg sim...");

  let breakerTrips = 0;
  let falsePositives = 0;
  const targetLagSlots = 225; // ~45s at 200ms/slot

  for (let tick = 0; tick < 100; tick++) {  // 7-day sim approximated by 100 fast ticks
    const currentSlot = await connection.getSlot();
    const laggedSlot = currentSlot - targetLagSlots;

    const injected = await lagInjector.injectLagPrice(priceHistory, laggedSlot);
    console.log(`Tick ${tick}: injected lagged price at slot ${laggedSlot}, price=${injected.price}`);

    const updatedPrice: PriceData = {
      price: injected.price,
      confidence: injected.confidence,
      timestamp: Date.now(),
    };

    await updatePriceAccount(connection, oraclePubkey, updatedPrice, wallet.payer);

    const isFalsePositive = checkTWAPFalsePositive(priceHistory, 0.85, 15);
    if (isFalsePositive) {
      falsePositives++;
      console.log("TWAP false-positive detected");
    }

    // Simulate vault drawdown circuit-breaker check (placeholder onchain call)
    try {
      await program.methods
        .checkDrawdown()
        .accounts({
          priceFeed: oraclePubkey,
          vault: PublicKey.unique(), // placeholder
        })
        .rpc();
    } catch (e) {
      if (e.toString().includes("BreakerTripped")) {
        breakerTrips++;
        console.log("Circuit breaker TRIPPED");
      }
    }

    // Advance simulated time
    await new Promise((r) => setTimeout(r, 15000)); // 15s per tick
  }

  console.log(`Simulation complete. Breaker trips: ${breakerTrips}, False positives: ${falsePositives}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
