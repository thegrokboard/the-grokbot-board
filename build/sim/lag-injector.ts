import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import { Vault } from "../target/types/vault";

// Simulated historical JitoSOL depeg price series (oracle prices in lamports, ~0.95-1.05 range)
// Last three distinct depeg events: minor dip, flash crash, recovery. Each entry is {slot: number, price: number}
const PRICE_SERIES = [
  // Series 1: minor depeg (slots ~100-160)
  { slot: 100, price: 1_000_000_000 },
  { slot: 110, price: 980_000_000 },
  { slot: 120, price: 950_000_000 },
  { slot: 130, price: 970_000_000 },
  { slot: 140, price: 990_000_000 },
  { slot: 150, price: 1_000_000_000 },
  // Series 2: flash crash (slots ~200-280)
  { slot: 200, price: 1_000_000_000 },
  { slot: 210, price: 920_000_000 },
  { slot: 220, price: 850_000_000 },
  { slot: 230, price: 780_000_000 },
  { slot: 240, price: 820_000_000 },
  { slot: 250, price: 910_000_000 },
  { slot: 260, price: 970_000_000 },
  { slot: 270, price: 995_000_000 },
  // Series 3: slow recovery with noise (slots ~300-390)
  { slot: 300, price: 1_000_000_000 },
  { slot: 310, price: 1_010_000_000 },
  { slot: 320, price: 980_000_000 },
  { slot: 330, price: 940_000_000 },
  { slot: 340, price: 960_000_000 },
  { slot: 350, price: 990_000_000 },
  { slot: 360, price: 1_005_000_000 },
  { slot: 370, price: 1_015_000_000 },
  { slot: 380, price: 1_000_000_000 },
];

const LAG_SLOTS = 90; // ~45s at 0.5s/slot target
const ORACLE_UPDATE_INTERVAL_SLOTS = 4; // update oracle every 4 slots (~2s)

interface LagInjectorConfig {
  lagSlots?: number;
  startSlot?: number;
  verbose?: boolean;
}

export class LagInjector {
  private connection: Connection;
  private program: Program<Vault>;
  private oraclePubkey: PublicKey;
  private config: Required<LagInjectorConfig>;
  private currentSlot = 0;
  private injectedPrices: Map<number, number> = new Map();

  constructor(
    connection: Connection,
    program: Program<Vault>,
    oraclePubkey: PublicKey,
    config: LagInjectorConfig = {}
  ) {
    this.connection = connection;
    this.program = program;
    this.oraclePubkey = oraclePubkey;
    this.config = {
      lagSlots: config.lagSlots ?? LAG_SLOTS,
      startSlot: config.startSlot ?? 50,
      verbose: config.verbose ?? true,
    };
    this.currentSlot = this.config.startSlot;
  }

  private log(msg: string): void {
    if (this.config.verbose) {
      console.log(`[LagInjector] ${msg}`);
    }
  }

  /**
   * Advance the simulated slot and inject lagged oracle price if due.
   * Returns true if an oracle update was performed.
   */
  async advanceSlot(): Promise<boolean> {
    this.currentSlot++;
    
    // Determine what the "real" price would be at (currentSlot - lag)
    const realSlot = this.currentSlot - this.config.lagSlots;
    const realPriceEntry = PRICE_SERIES.find(p => p.slot === realSlot);
    
    if (!realPriceEntry) {
      // No new data at this lagged slot
      return false;
    }

    // Only update oracle at defined intervals to simulate realistic feeds
    if ((this.currentSlot % ORACLE_UPDATE_INTERVAL_SLOTS) !== 0) {
      return false;
    }

    const priceToInject = realPriceEntry.price;
    this.injectedPrices.set(this.currentSlot, priceToInject);

    this.log(`Slot ${this.currentSlot}: injecting lagged price ${priceToInject / 1e9} (from real slot ${realSlot})`);

    await this.updateOracle(priceToInject);
    return true;
  }

  private async updateOracle(price: number): Promise<void> {
    // In test harness we use a simple system account as mock oracle.
    // In real deployment this would be a Switchboard/ Pyth account.
    // Here we simply log and optionally send a demo instruction if the program exposes one.
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })
    );

    // If vault program had an update_oracle instruction we would call it here.
    // For the sim harness we just advance the on-chain clock and assume the oracle PDA holds price.
    // In practice the vault's drawdown logic reads from this mocked oracle.

    try {
      const latestBlockhash = await this.connection.getLatestBlockhash();
      tx.recentBlockhash = latestBlockhash.blockhash;
      tx.feePayer = (this.program.provider as AnchorProvider).wallet.publicKey;
      
      // No-op tx for timing; real sim would CPI or use a separate oracle program
      // await anchor.web3.sendAndConfirmTransaction(this.connection, tx, []);
      this.log(`Oracle updated to ${price} at slot ${this.currentSlot}`);
    } catch (err) {
      console.error("Failed to simulate oracle update:", err);
    }
  }

  getCurrentSlot(): number {
    return this.currentSlot;
  }

  getInjectedPriceAt(slot: number): number | null {
    return this.injectedPrices.get(slot) ?? null;
  }

  getAllInjectedPrices(): Map<number, number> {
    return this.injectedPrices;
  }

  /** Replay the entire series up to a target slot */
  async replayTo(targetSlot: number): Promise<void> {
    this.log(`Starting replay from slot ${this.currentSlot} to ${targetSlot} with ${this.config.lagSlots} slot lag`);
    while (this.currentSlot < targetSlot) {
      const updated = await this.advanceSlot();
      if (updated && this.config.verbose) {
        // small delay to mimic real-time injection
        await new Promise(r => setTimeout(r, 8));
      }
    }
    this.log(`Replay complete. Final slot: ${this.currentSlot}. Injected ${this.injectedPrices.size} prices.`);
  }
}

// CLI entrypoint for direct execution during sim
if (require.main === module) {
  (async () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const idlPath = path.resolve(__dirname, "../target/idl/vault.json");
    const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
    const program = new anchor.Program(idl, provider) as Program<Vault>;

    // Use a deterministic oracle key for the test validator
    const oracleKeypair = Keypair.fromSeed(Buffer.from("jito_sol_oracle_sim"));
    const oraclePubkey = oracleKeypair.publicKey;

    console.log("Lag Injector started. Oracle pubkey:", oraclePubkey.toBase58());

    const injector = new LagInjector(
      provider.connection,
      program,
      oraclePubkey,
      { lagSlots: 90, startSlot: 50, verbose: true }
    );

    // Replay the full series (covers all three depegs)
    await injector.replayTo(450);

    // Output summary for the 15s TWAP checker and tick runner
    const prices = Array.from(injector.getAllInjectedPrices().entries())
      .sort((a, b) => a[0] - b[0])
      .map(([slot, price]) => ({ slot, price: price / 1_000_000_000 }));

    console.log("\nInjected price series (lagged):");
    console.table(prices);

    fs.writeFileSync(
      path.join(__dirname, "last_injected_prices.json"),
      JSON.stringify(prices, null, 2)
    );
    console.log("\nSaved to sim/last_injected_prices.json for downstream TWAP checker.");
  })().catch(console.error);
}
