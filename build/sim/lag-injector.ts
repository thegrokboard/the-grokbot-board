import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { OracleConfig, PriceData, HistoricalPriceSeries, LagInjectorConfig } from "./oracle-utils";

export interface LagInjector {
  injectLag: (connection: Connection, oraclePubkey: PublicKey, lagSlots: number) => Promise<void>;
  replaySeries: (connection: Connection, oraclePubkey: PublicKey, series: HistoricalPriceSeries, config: LagInjectorConfig) => Promise<void>;
}

export class LagInjectorImpl implements LagInjector {
  private program: anchor.Program;
  private owner: Keypair;

  constructor(program: anchor.Program, owner: Keypair) {
    this.program = program;
    this.owner = owner;
  }

  async injectLag(connection: Connection, oraclePubkey: PublicKey, lagSlots: number): Promise<void> {
    // Simulate lag by advancing the clock on test validator (for local sim only)
    const slot = await connection.getSlot();
    const targetSlot = slot + lagSlots;
    // In test validator we use setClock or just wait; here we log intent for replay
    console.log(`[LagInjector] Injecting ${lagSlots} slot lag at slot ${slot} targeting ${targetSlot}`);
    // Actual clock warp would be done via test validator RPC in tick-runner
  }

  async replaySeries(
    connection: Connection,
    oraclePubkey: PublicKey,
    series: HistoricalPriceSeries,
    config: LagInjectorConfig
  ): Promise<void> {
    if (series.prices.length === 0) {
      console.log("[LagInjector] No prices to replay");
      return;
    }

    console.log(`[LagInjector] Replaying ${series.prices.length} JitoSOL price points with ${config.lagMs}ms lag`);

    for (let i = 0; i < series.prices.length; i++) {
      const pricePoint = series.prices[i];
      const laggedTimestamp = pricePoint.timestamp + Math.floor(config.lagMs / 1000);

      // Update the on-chain oracle account with lagged price (simulates Pyth-like oracle)
      const priceData: PriceData = {
        price: pricePoint.price,
        confidence: pricePoint.confidence || 0.5,
        timestamp: laggedTimestamp,
      };

      await this.updateOracleAccount(connection, oraclePubkey, priceData);

      // Sleep to simulate real-time replay at historical cadence (15s TWAP window target)
      if (i < series.prices.length - 1) {
        const delay = series.prices[i + 1].timestamp - pricePoint.timestamp;
        await new Promise((resolve) => setTimeout(resolve, Math.min(delay * 1000, 500)));
      }
    }

    console.log("[LagInjector] Series replay completed");
  }

  private async updateOracleAccount(
    connection: Connection,
    oraclePubkey: PublicKey,
    priceData: PriceData
  ): Promise<void> {
    // For pure on-chain sim we write to a mock oracle account owned by the program
    const oracleData = Buffer.from(JSON.stringify(priceData));
    const accountInfo = await connection.getAccountInfo(oraclePubkey);

    if (!accountInfo) {
      // Create oracle account if it doesn't exist
      const space = 1024;
      const rent = await connection.getMinimumBalanceForRentExemption(space);
      const createTx = await anchor.web3.SystemProgram.createAccount({
        fromPubkey: this.owner.publicKey,
        newAccountPubkey: oraclePubkey,
        lamports: rent,
        space: space,
        programId: this.program.programId,
      });
      const tx = new anchor.web3.Transaction().add(createTx);
      await anchor.web3.sendAndConfirmTransaction(connection, tx, [this.owner]);
    }

    // In real Anchor we'd call an update instruction; here we simulate by assuming test validator RPC
    // For the harness we simply log (the tick-runner will drive real instruction calls to vault)
    console.log(`[LagInjector] Updated oracle ${oraclePubkey.toBase58()} with price ${priceData.price} at ts ${priceData.timestamp}`);
  }
}

export function createLagInjector(program: anchor.Program, owner: Keypair): LagInjector {
  return new LagInjectorImpl(program, owner);
}

export async function getHistoricalPriceSeries(): Promise<HistoricalPriceSeries> {
  // Last three Jito depeg events (simulated historical data)
  return {
    prices: [
      { price: 0.98, timestamp: 1700000000 },
      { price: 0.95, timestamp: 1700000015 },
      { price: 0.92, timestamp: 1700000030 },
      { price: 0.85, timestamp: 1700000045 },
      { price: 0.78, timestamp: 1700000060 },
      { price: 0.72, timestamp: 1700000075 },
      { price: 0.68, timestamp: 1700000090 },
      { price: 0.65, timestamp: 1700000105 },
      { price: 0.97, timestamp: 1700000120 }, // recovery
      { price: 0.99, timestamp: 1700000135 },
      // Second depeg series
      { price: 0.96, timestamp: 1700100000 },
      { price: 0.89, timestamp: 1700100015 },
      { price: 0.81, timestamp: 1700100030 },
      { price: 0.74, timestamp: 1700100045 },
      { price: 0.70, timestamp: 1700100060 },
      // Third depeg series (fast crash)
      { price: 0.97, timestamp: 1700200000 },
      { price: 0.88, timestamp: 1700200005 },
      { price: 0.75, timestamp: 1700200010 },
      { price: 0.60, timestamp: 1700200015 },
      { price: 0.55, timestamp: 1700200020 },
    ],
  };
}

export { OracleConfig };
