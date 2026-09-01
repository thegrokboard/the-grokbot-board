import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { createLagInjector, injectLagPrice } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createPriceAccount, updatePriceAccount, PriceData } from "./oracle-utils";
import { Vault } from "../target/types/vault";

const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Yg5pL2");
const PYTH_ORACLE_PROGRAM = new PublicKey("FsJ3A3u2vn5cTVofAjvy6y5kwxK8wJ8bH4t6jD6p3z");

async function main() {
  // Setup provider with local test validator
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const payer = Keypair.generate();
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as Program<Vault>;

  // Airdrop to payer
  const airdropSig = await connection.requestAirdrop(payer.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdropSig);

  // Create oracle price account (simulating JitoSOL / USD)
  const oracleAccount = await createPriceAccount(provider, PYTH_ORACLE_PROGRAM);

  // Initialize vault (minimal on-chain state)
  const vault = Keypair.generate();
  const protectionBuffer = Keypair.generate();

  await program.methods
    .initialize()
    .accounts({
      vault: vault.publicKey,
      owner: provider.wallet.publicKey,
      protectionBuffer: protectionBuffer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([vault, protectionBuffer])
    .rpc();

  // Create lag injector for replaying last three Jito depeg series with 45s lag
  const lagInjector = createLagInjector(45);

  // Historical Jito depeg price series (simplified for test: price in USD, 3 recent "ticks")
  const priceHistory: PriceData[] = [
    { price: 0.92, confidence: 0.01, timestamp: Date.now() / 1000 - 180, slot: 1000 },
    { price: 0.88, confidence: 0.02, timestamp: Date.now() / 1000 - 120, slot: 1100 },
    { price: 0.75, confidence: 0.05, timestamp: Date.now() / 1000 - 60, slot: 1200 },
    { price: 0.68, confidence: 0.08, timestamp: Date.now() / 1000 - 30, slot: 1250 },
    { price: 0.95, confidence: 0.01, timestamp: Date.now() / 1000, slot: 1300 },
  ];

  console.log("Starting 7-day sim tick runner (replaying Jito depeg series with lag)...");

  let breakerTrips = 0;
  let falsePositives = 0;
  let tick = 0;
  const MAX_TICKS = 42; // ~7 simulated "days" at 15s TWAP checks

  while (tick < MAX_TICKS) {
    // Inject lagged price into oracle (slot-exact)
    const currentData = priceHistory[tick % priceHistory.length];
    await injectLagPrice(provider, oracleAccount, currentData, lagInjector);

    // Run 15s TWAP false-positive checker
    const isFalsePositive = checkTWAPFalsePositive(priceHistory.slice(0, tick + 1));
    if (isFalsePositive) {
      falsePositives++;
      console.log(`Tick ${tick}: TWAP false positive detected`);
    }

    // Call on-chain drawdown circuit-breaker (if TWAP below threshold)
    const twap = computeSimpleTWAP(priceHistory.slice(0, tick + 1));
    if (twap < 0.85) {
      try {
        await program.methods
          .triggerCircuitBreaker()
          .accounts({
            vault: vault.publicKey,
            oracle: oracleAccount,
            owner: provider.wallet.publicKey,
          })
          .rpc();
        breakerTrips++;
        console.log(`Tick ${tick}: CIRCUIT BREAKER TRIPPED (TWAP=${twap.toFixed(3)})`);
      } catch (e) {
        console.log(`Tick ${tick}: breaker already tripped or tx failed`);
      }
    }

    tick++;
    // Simulate time passage (in real test validator this is just ticks)
    await new Promise((r) => setTimeout(r, 200)); // fast-forward sim
  }

  console.log("\n=== Simulation Complete ===");
  console.log(`Breaker trips: ${breakerTrips}`);
  console.log(`False positives: ${falsePositives}`);
  console.log("Pure on-chain Anchor JitoSOL depeg sim harness finished.");
}

// Simple TWAP helper for sim (15s window approximated by recent ticks)
function computeSimpleTWAP(prices: PriceData[]): number {
  if (prices.length === 0) return 1.0;
  const sum = prices.reduce((acc, p) => acc + p.price, 0);
  return sum / prices.length;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
