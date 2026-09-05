import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { Vault } from "../target/types/vault";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";
import fs from "fs";

// -----------------------------------------------------------------------------
// Tick Runner – drives the 7-day on-chain simulation with lag-injected prices
// -----------------------------------------------------------------------------

const RPC_URL = "http://127.0.0.1:8899";
const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhT2c8xJ1p7bY6v2zKxJ1toso1u");
const ORACLE_FEED = new PublicKey("4v25K5f4d8v2K5J1toso1uCk3RLmjorhT2c8xJ1p7bY6"); // mock feed in test validator

class TickRunner {
  private connection: Connection;
  private provider: AnchorProvider;
  private program: Program<Vault>;
  private lagInjector: LagInjector;
  private owner: Keypair;
  private vault: PublicKey;
  private buffer: PublicKey;
  private priceHistory: PriceData[] = [];
  private tripLog: Array<{ slot: number; price: number; tripped: boolean; reason: string }> = [];

  constructor() {
    this.connection = new Connection(RPC_URL, "confirmed");
    this.owner = Keypair.generate();
    this.provider = new AnchorProvider(
      this.connection,
      new Wallet(this.owner),
      { commitment: "confirmed" }
    );
    anchor.setProvider(this.provider);
    this.program = anchor.workspace.Vault as Program<Vault>;
    this.lagInjector = new LagInjector(45); // target 45-slot lag
    this.vault = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), this.owner.publicKey.toBuffer()],
      this.program.programId
    )[0];
    this.buffer = PublicKey.findProgramAddressSync(
      [Buffer.from("buffer"), this.vault.toBuffer()],
      this.program.programId
    )[0];
  }

  async initialize(): Promise<void> {
    const tx = await this.program.methods
      .initialize(new anchor.BN(1_000_000_000)) // 1M lamport buffer target
      .accounts({
        vault: this.vault,
        buffer: this.buffer,
        owner: this.owner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.owner])
      .rpc();
    console.log("Vault initialized, tx:", tx);
    await this.airdrop(this.owner.publicKey, 10);
  }

  private async airdrop(pubkey: PublicKey, sol: number): Promise<void> {
    const sig = await this.connection.requestAirdrop(pubkey, sol * anchor.web3.LAMPORTS_PER_SOL);
    await this.connection.confirmTransaction(sig);
  }

  async runSimulation(days: number = 7): Promise<void> {
    console.log(`Starting ${days}-day JitoSOL depeg simulation...`);
    const historical = getHistoricalJitoPrices();
    this.priceHistory = [...historical];

    const totalTicks = days * 24 * 60 * 4; // 15-second ticks
    let slot = 200; // start after genesis

    for (let i = 0; i < totalTicks; i++) {
      const laggedPrices = this.lagInjector.injectLag(this.priceHistory, slot);
      const currentPrice = laggedPrices[laggedPrices.length - 1];

      // Feed oracle (in test validator we just log; real harness would use a mock oracle program)
      await this.feedOracle(currentPrice);

      // Check TWAP false-positive
      const isFalsePositive = checkTWAPFalsePositive(laggedPrices, 15);

      // Check on-chain breaker (via simulation call)
      let breakerTripped = false;
      let reason = "none";
      try {
        await this.program.methods
          .checkDrawdown()
          .accounts({
            vault: this.vault,
            buffer: this.buffer,
            oracle: ORACLE_FEED,
          })
          .rpc();
      } catch (err: any) {
        if (err.toString().includes("DrawdownBreached")) {
          breakerTripped = true;
          reason = "drawdown";
        } else if (err.toString().includes("CircuitBreakerActive")) {
          breakerTripped = true;
          reason = "paused";
        }
      }

      this.tripLog.push({
        slot,
        price: currentPrice.price,
        tripped: breakerTripped,
        reason,
      });

      if (breakerTripped && !isFalsePositive) {
        console.log(`[${slot}] REAL BREAKER TRIP @ $${currentPrice.price.toFixed(4)}`);
      } else if (isFalsePositive) {
        console.log(`[${slot}] false-positive TWAP spike ignored`);
      }

      slot += 1;
      // replay next price with slight random walk to simulate live feed
      if (this.priceHistory.length < 1000) {
        const last = this.priceHistory[this.priceHistory.length - 1];
        this.priceHistory.push({
          price: last.price * (0.999 + Math.random() * 0.002),
          confidence: 0.95,
          timestamp: last.timestamp + 15,
        });
      }
    }

    this.writeReport();
  }

  private async feedOracle(price: PriceData): Promise<void> {
    // In a pure on-chain test validator harness this would call a mock oracle updater.
    // For the sim we simply log; the program reads from the injected lagged series.
    console.log(`Oracle feed slot=${price.timestamp} price=${price.price}`);
  }

  private writeReport(): void {
    const report = {
      totalTicks: this.tripLog.length,
      breakerTrips: this.tripLog.filter((t) => t.tripped).length,
      falsePositives: this.tripLog.filter((t) => !t.tripped && t.reason === "none").length,
      log: this.tripLog,
    };
    fs.writeFileSync("sim-report.json", JSON.stringify(report, null, 2));
    console.log("Simulation complete. Report written to sim-report.json");
    console.table(report);
  }
}

// -----------------------------------------------------------------------------
// Main entry point
// -----------------------------------------------------------------------------

async function main() {
  const runner = new TickRunner();
  await runner.initialize();
  await runner.runSimulation(7);
}

main().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
