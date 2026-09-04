import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";

const LAG_SECONDS = 45;
const TICK_INTERVAL_MS = 15000; // 15s TWAP checks
const SIM_DURATION_SLOTS = 7 * 24 * 60 * 4; // ~7 days at 0.4s/slot
const ORACLE_LAG_SLOTS = Math.floor(LAG_SECONDS / 0.4);

class TickRunner {
  private injector: LagInjector;
  private connection: Connection;
  private program: Program<Vault>;
  private vaultPubkey: PublicKey;
  private bufferPubkey: PublicKey;
  private owner: Keypair;
  private currentSlot = 0;
  private tripLog: string[] = [];
  private falsePositiveLog: string[] = [];

  constructor(provider: anchor.Provider) {
    this.connection = provider.connection;
    this.program = anchor.workspace.Vault as Program<Vault>;
    this.owner = Keypair.generate();
    this.injector = new LagInjector(ORACLE_LAG_SLOTS);
    // Derive PDAs (matching program)
    this.vaultPubkey = PublicKey.findProgramAddressSync(
      [Buffer.from("vault")],
      this.program.programId
    )[0];
    this.bufferPubkey = PublicKey.findProgramAddressSync(
      [Buffer.from("protection_buffer")],
      this.program.programId
    )[0];
  }

  async initialize() {
    // Fund owner
    const airdrop = await this.connection.requestAirdrop(this.owner.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await this.connection.confirmTransaction(airdrop);
    
    // Initialize vault on-chain
    await this.program.methods
      .initialize()
      .accounts({
        vault: this.vaultPubkey,
        owner: this.owner.publicKey,
        buffer: this.bufferPubkey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([this.owner])
      .rpc();
    
    console.log("Vault initialized. Starting 7-day simulation replay...");
  }

  async run() {
    await this.initialize();

    // Load historical JitoSOL price series for replay
    const historical: PriceData[] = getHistoricalJitoPrices();
    this.injector.replaySeries(historical);

    let ticks = 0;
    const startSlot = this.currentSlot;

    while (this.currentSlot < startSlot + SIM_DURATION_SLOTS) {
      // Advance simulated slot
      this.currentSlot += 1;
      this.injector.advanceSlot();

      // Every 15s perform TWAP check (roughly every 38 slots)
      if (this.currentSlot % 38 === 0) {
        ticks++;
        const currentPrice = this.injector.getCurrentPrice();
        if (!currentPrice) continue;

        const isFalsePositive = checkTWAPFalsePositive(
          this.injector.getReplayedSeries(),
          currentPrice.price,
          15 // minutes window
        );

        if (isFalsePositive) {
          this.falsePositiveLog.push(`Slot ${this.currentSlot}: TWAP false-positive detected (price=${currentPrice.price})`);
        } else if (currentPrice.price < 0.85) { // drawdown threshold
          // Trigger on-chain circuit breaker
          try {
            await this.program.methods
              .triggerDrawdown()
              .accounts({
                vault: this.vaultPubkey,
                buffer: this.bufferPubkey,
                owner: this.owner.publicKey,
              })
              .signers([this.owner])
              .rpc();
            this.tripLog.push(`Slot ${this.currentSlot}: CIRCUIT BREAKER TRIPPED (price=${currentPrice.price.toFixed(4)})`);
            console.log(`\x1b[31mBREAKER TRIP at slot ${this.currentSlot}\x1b[0m`);
            break; // stop sim on real trip
          } catch (e) {
            this.tripLog.push(`Slot ${this.currentSlot}: breaker tx failed - ${e}`);
          }
        }
      }

      // Simulate pause/withdraw capability (owner can pause)
      if (this.currentSlot % 200 === 0 && this.tripLog.length > 0) {
        await this.program.methods
          .pause()
          .accounts({
            vault: this.vaultPubkey,
            owner: this.owner.publicKey,
          })
          .signers([this.owner])
          .rpc()
          .catch(() => {});
      }

      if (ticks % 100 === 0 && ticks > 0) {
        console.log(`Sim progress: ${((this.currentSlot - startSlot) / SIM_DURATION_SLOTS * 100).toFixed(1)}% (${ticks} TWAP checks)`);
      }
    }

    this.printResults();
  }

  private printResults() {
    console.log("\n=== 7-DAY SIMULATION COMPLETE ===");
    console.log(`Total TWAP checks: ${this.falsePositiveLog.length + this.tripLog.length}`);
    console.log(`Circuit breaker trips: ${this.tripLog.length}`);
    console.log(`False positives: ${this.falsePositiveLog.length}`);
    
    console.log("\n--- Trips ---");
    this.tripLog.forEach(log => console.log(log));
    
    console.log("\n--- False Positives ---");
    this.falsePositiveLog.forEach(log => console.log(log));
    
    if (this.tripLog.length === 0) {
      console.log("\n\x1b[32mNo breaker trips. Protection buffer held.\x1b[0m");
    }
  }

  getTripLog() { return this.tripLog; }
  getFalsePositiveLog() { return this.falsePositiveLog; }
}

// Run the simulation when executed directly
if (require.main === module) {
  (async () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    
    const runner = new TickRunner(provider);
    try {
      await runner.run();
    } catch (err) {
      console.error("Simulation failed:", err);
      process.exit(1);
    }
  })();
}

export { TickRunner };
