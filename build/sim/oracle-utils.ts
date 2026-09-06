import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction, Connection, Keypair } from "@solana/web3.js";
import { OracleConfig } from "../programs/vault/target/types/vault"; // Align with program IDL if needed, but use local for sim

export namespace OracleUtils {
  export interface PriceData {
    price: number;
    timestamp: number;
  }

  export interface HistoricalPriceSeries {
    prices: PriceData[];
    startSlot: number;
    endSlot: number;
  }

  export interface LagInjectorConfig {
    lagMs: number;
    slotMs: number;
    series: HistoricalPriceSeries[];
  }

  export interface OracleConfig {
    oraclePubkey: PublicKey;
    updateAuthority: PublicKey;
  }

  export class LagInjector {
    private connection: Connection;
    private oraclePubkey: PublicKey;
    private updateAuthority: Keypair;
    private config: LagInjectorConfig;

    constructor(
      connection: Connection,
      oraclePubkey: PublicKey,
      updateAuthority: Keypair,
      config: LagInjectorConfig
    ) {
      this.connection = connection;
      this.oraclePubkey = oraclePubkey;
      this.updateAuthority = updateAuthority;
      this.config = config;
    }

    static createLagInjectorConfig(
      lagMs: number = 45000,
      slotMs: number = 400,
      series: HistoricalPriceSeries[] = []
    ): LagInjectorConfig {
      return {
        lagMs,
        slotMs,
        series,
      };
    }

    static createOracleConfig(
      oraclePubkey: PublicKey,
      updateAuthority: PublicKey
    ): OracleConfig {
      return {
        oraclePubkey,
        updateAuthority,
      };
    }

    async injectSeries(series: HistoricalPriceSeries[]): Promise<void> {
      this.config.series = [...series];
    }

    createUpdatePriceInstruction(
      price: number,
      timestamp: number,
      slot: number
    ): TransactionInstruction {
      // Minimal placeholder matching expected signature for test harness
      // In real harness this would build a Switchboard or custom oracle update IX
      const data = Buffer.from([0, ...new Uint8Array(new Float64Array([price]).buffer)]);
      return new TransactionInstruction({
        keys: [
          { pubkey: this.oraclePubkey, isSigner: false, isWritable: true },
          { pubkey: this.updateAuthority.publicKey, isSigner: true, isWritable: false },
        ],
        programId: new PublicKey("11111111111111111111111111111111"), // placeholder
        data,
      });
    }

    async updateOracleWithLag(
      currentSlot: number,
      provider: anchor.Provider
    ): Promise<void> {
      const lagSlots = Math.floor(this.config.lagMs / this.config.slotMs);
      const effectiveSlot = currentSlot - lagSlots;

      for (const series of this.config.series) {
        const pricePoint = series.prices.find((p) => p.timestamp <= effectiveSlot);
        if (pricePoint) {
          const ix = this.createUpdatePriceInstruction(
            pricePoint.price,
            pricePoint.timestamp,
            effectiveSlot
          );
          const tx = new anchor.web3.Transaction().add(ix);
          // Sign with update authority for sim
          await anchor.web3.sendAndConfirmTransaction(
            this.connection,
            tx,
            [this.updateAuthority],
            { commitment: "confirmed" }
          );
          break;
        }
      }
    }

    getLatestPrice(currentSlot: number): PriceData | null {
      const lagSlots = Math.floor(this.config.lagMs / this.config.slotMs);
      const effectiveSlot = currentSlot - lagSlots;

      for (const series of this.config.series) {
        const point = series.prices
          .slice()
          .reverse()
          .find((p) => p.timestamp <= effectiveSlot);
        if (point) return point;
      }
      return null;
    }
  }

  export function createHistoricalPriceSeries(
    prices: PriceData[],
    startSlot: number,
    endSlot: number
  ): HistoricalPriceSeries {
    return { prices, startSlot, endSlot };
  }

  // Export class and factory for direct usage in other modules
  export const LagInjectorClass = LagInjector;
}
