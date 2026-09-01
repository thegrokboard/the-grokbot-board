import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import { createLagInjector, injectLagPrice } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createPriceAccount, updatePriceAccount, PriceData } from "./oracle-utils";

const SIM_SLOTS = 7 * 24 * 60 * 4; // 7 days at ~0.4s/slot
const TARGET_LAG_SLOTS = 112; // ~45s
const ORACLE_UPDATE_INTERVAL = 4; // every slot*4 ~1.6s

async function main() {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as Program<Vault>;
  const connection = provider.connection;

  // Setup test accounts
  const owner = Keypair.generate();
  const payer = (provider.wallet as Wallet).payer;

  // Airdrop
  await connection.requestAirdrop(owner.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
  await connection.requestAirdrop(payer.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);

  // Create mock oracle (JitoSOL price feed)
  const oraclePubkey = await createPriceAccount(connection, payer);

  // Create vault
  const vaultKeypair = Keypair.generate();
  const [protectionBuffer, _bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("protection"), vaultKeypair.publicKey.toBuffer()],
    program.programId
  );

  await program.methods
    .initialize(new anchor.BN(1000)) // 10% buffer target
    .accounts({
      vault: vaultKeypair.publicKey,
      owner: owner.publicKey,
      protectionBuffer,
      oracle: oraclePubkey,
      systemProgram: SystemProgram.programId,
    })
    .signers([vaultKeypair, owner])
    .rpc();

  // Create lag injector
  const injector = createLagInjector(
    connection,
    oraclePubkey,
    TARGET_LAG_SLOTS,
    payer
  );

  console.log("Starting 7-day JitoSOL depeg simulation with oracle lag...");

  let breakerTrips = 0;
  let falsePositives = 0;
  let lastPrice: PriceData | null = null;

  // Replay last three known depeg series with lag
  const depegSeries: Array<{ price: number; confidence: number; timestamp: number }> = [
    // Series 1: mild depeg (historical replay)
    { price: 0.98, confidence: 0.95, timestamp: Date.now() / 1000 },
    { price: 0.92, confidence: 0.80, timestamp: Date.now() / 1000 + 30 },
    { price: 0.85, confidence: 0.75, timestamp: Date.now() / 1000 + 90 },
    // Series 2: sharp depeg
    { price: 0.75, confidence: 0.60, timestamp: Date.now() / 1000 + 180 },
    { price: 0.65, confidence: 0.55, timestamp: Date.now() / 1000 + 240 },
    // Series 3: recovery
    { price: 0.88, confidence: 0.85, timestamp: Date.now() / 1000 + 400 },
    { price: 0.97, confidence: 0.92, timestamp: Date.now() / 1000 + 600 },
  ];

  for (let slot = 0; slot < SIM_SLOTS; slot++) {
    const simTime = Date.now() + slot * 400; // ~400ms per slot

    // Inject lagged price every interval
    if (slot % ORACLE_UPDATE_INTERVAL === 0 && depegSeries.length > 0) {
      const nextPrice = depegSeries.shift()!;
      const priceData: PriceData = {
        price: nextPrice.price,
        confidence: nextPrice.confidence,
        timestamp: nextPrice.timestamp,
        slot: slot,
      };

      await injectLagPrice(injector, priceData);
      lastPrice = priceData;

      // Update on-chain oracle
      await updatePriceAccount(connection, oraclePubkey, priceData, payer);
    }

    // Run TWAP false-positive check every 15s (~37-38 slots)
    if (slot % 38 === 0 && lastPrice) {
      const isFalsePositive = checkTWAPFalsePositive(
        lastPrice,
        { price: 0.90, confidence: 0.8, timestamp: simTime / 1000, slot: slot - 10 },
        0.15 // 15% drawdown threshold
      );

      if (isFalsePositive) {
        falsePositives++;
        console.log(`[${slot}] TWAP false-positive detected`);
      } else if (lastPrice.price < 0.85) {
        // Simulate drawdown circuit breaker trip
        try {
          await program.methods
            .triggerDrawdown()
            .accounts({
              vault: vaultKeypair.publicKey,
              owner: owner.publicKey,
              oracle: oraclePubkey,
              protectionBuffer,
            })
            .signers([owner])
            .rpc();
          breakerTrips++;
          console.log(`[${slot}] CIRCUIT BREAKER TRIPPED at price ${lastPrice.price}`);
        } catch (e) {
          // already tripped or paused
        }
      }
    }

    // Simulate owner pause/withdraw occasionally
    if (slot === 200) {
      await program.methods
        .pause()
        .accounts({
          vault: vaultKeypair.publicKey,
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();
      console.log(`[${slot}] Vault paused by owner`);
    }
  }

  console.log("\nSimulation complete:");
  console.log(`  Breaker trips: ${breakerTrips}`);
  console.log(`  False positives: ${falsePositives}`);
  console.log(`  False positive rate: ${((falsePositives / Math.max(breakerTrips, 1)) * 100).toFixed(1)}%`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
