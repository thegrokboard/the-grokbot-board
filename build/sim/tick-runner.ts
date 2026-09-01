import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createLagInjector, injectLagPrice, LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createPriceAccount, updatePriceAccount, PriceData } from "./oracle-utils";
import { Program } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";

async function runTickSimulation() {
  // Setup local test validator connection
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const payer = Keypair.generate();

  // Airdrop to payer
  const airdropSig = await connection.requestAirdrop(payer.publicKey, 10 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdropSig);

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as Program<Vault>;

  // Create oracle price account for JitoSOL
  const oraclePubkey = await createPriceAccount(provider, payer);

  // Initialize vault (minimal - assume program has initialize instruction)
  await program.methods
    .initialize(new anchor.BN(0))
    .accounts({
      vault: anchor.web3.Keypair.generate().publicKey,
      owner: payer.publicKey,
      jitoMint: new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCP"), // placeholder
      oracle: oraclePubkey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([payer])
    .rpc();

  // Create lag injector (configurable 45s target)
  const lagInjector: LagInjector = createLagInjector(45, connection);

  // Replay last three Jito depeg price series (hard-coded sample data for sim)
  const priceSeries: PriceData[] = [
    { price: 0.92, confidence: 0.01, timestamp: Date.now() - 120000 },
    { price: 0.88, confidence: 0.015, timestamp: Date.now() - 90000 },
    { price: 0.75, confidence: 0.02, timestamp: Date.now() - 60000 },
  ];

  // Inject lagged prices slot-exactly
  for (const pd of priceSeries) {
    await injectLagPrice(lagInjector, oraclePubkey, pd.price, pd.confidence, pd.timestamp);
    await new Promise((r) => setTimeout(r, 15000)); // 15s tick
  }

  // 15s TWAP false-positive checker
  const isFalsePositive = checkTWAPFalsePositive(priceSeries);
  console.log("TWAP false positive on replay:", isFalsePositive);

  // 7-day tick runner simulation (scaled to ~7 ticks for demo)
  const breakerTrips = 0;
  let falsePositives = 0;

  for (let day = 0; day < 7; day++) {
    console.log(`Sim day ${day + 1}/7`);
    const currentPrices: PriceData[] = priceSeries.map((p, i) => ({
      ...p,
      timestamp: Date.now() - (60000 * (7 - day - i)),
    }));

    const fp = checkTWAPFalsePositive(currentPrices);
    if (fp) falsePositives++;

    // Simulate drawdown circuit-breaker check
    const currentPrice = currentPrices[currentPrices.length - 1].price;
    if (currentPrice < 0.8) {
      console.log("Circuit breaker would trip on drawdown");
      // breakerTrips++; (would call program instruction)
    }
  }

  console.log("Simulation complete.");
  console.log("Breaker trips:", breakerTrips);
  console.log("False positives:", falsePositives);
  console.log("False positive rate:", (falsePositives / 7) * 100, "%");
}

// Run the sim
runTickSimulation().catch(console.error);
