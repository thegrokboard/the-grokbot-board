import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { readFileSync } from "fs";

const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCP");
const ORACLE_FEED = new PublicKey("8y5vW2o7X1nV9jX3z4k5m6n7p8q9r0s1t2u3v4w5x6");

interface PriceTick {
  slot: number;
  price: number; // in USD, scaled by 1e9
  timestamp: number;
}

export class LagInjector {
  private program: Program<Vault>;
  private provider: AnchorProvider;
  private lagSlots: number;
  private priceSeries: PriceTick[] = [];
  private currentTick = 0;

  constructor(provider: AnchorProvider, lagSeconds: number = 45) {
    this.provider = provider;
    this.program = new Program<Vault>(
      require("../target/idl/vault.json"),
      provider
    );
    this.lagSlots = Math.floor(lagSeconds * 2); // ~2 slots per second on devnet/test
    this.loadPriceSeries();
  }

  private loadPriceSeries() {
    try {
      const raw = readFileSync("sim/jito-depeg-series.json", "utf-8");
      this.priceSeries = JSON.parse(raw) as PriceTick[];
      console.log(`Loaded ${this.priceSeries.length} price ticks from replay series`);
    } catch (e) {
      console.warn("No replay series found, using synthetic data");
      this.priceSeries = this.generateSyntheticSeries();
    }
  }

  private generateSyntheticSeries(): PriceTick[] {
    const series: PriceTick[] = [];
    const baseSlot = 100000000;
    let price = 1_000_000_000; // $1.00 * 1e9
    for (let i = 0; i < 300; i++) {
      const slot = baseSlot + i * 4;
      if (i > 180 && i < 240) price = Math.floor(price * 0.85); // simulate depeg
      series.push({
        slot,
        price: Math.max(price, 700_000_000),
        timestamp: Date.now() / 1000 + i * 0.5,
      });
    }
    return series;
  }

  async injectLag(currentSlot: number): Promise<void> {
    if (this.currentTick >= this.priceSeries.length) {
      this.currentTick = 0;
    }

    const tick = this.priceSeries[this.currentTick];
    const laggedSlot = Math.max(0, currentSlot - this.lagSlots);

    // Update oracle with lagged price via program instruction (sim harness)
    const tx = await this.program.methods
      .updateOracle(new anchor.BN(tick.price), new anchor.BN(laggedSlot))
      .accounts({
        oracle: ORACLE_FEED,
        authority: this.provider.wallet.publicKey,
      })
      .rpc({ commitment: "confirmed" });

    console.log(`Injected lagged price ${tick.price / 1e9} at slot ${laggedSlot} (real slot ${currentSlot})`);
    this.currentTick++;
  }

  getCurrentPrice(): number {
    if (this.priceSeries.length === 0) return 1_000_000_000;
    return this.priceSeries[Math.min(this.currentTick, this.priceSeries.length - 1)].price;
  }

  async advanceToNextTick(): Promise<number> {
    const slot = await this.provider.connection.getSlot("confirmed");
    await this.injectLag(slot);
    return slot;
  }
}

// CLI entrypoint for testing
async function main() {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);

  const injector = new LagInjector(provider, 45);
  
  for (let i = 0; i < 10; i++) {
    await injector.advanceToNextTick();
    await new Promise((r) => setTimeout(r, 1500));
  }
}

if (require.main === module) {
  main().catch(console.error);
}
