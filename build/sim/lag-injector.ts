import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import { OracleUtils, PriceData } from "./oracle-utils";

export interface LagInjectorConfig {
  oraclePubkey: PublicKey;
  lagSlots: number;
  replaySeries: PriceData[];
}

export class LagInjector {
  private oracleUtils: OracleUtils;
  private lagSlots: number;
  private replaySeries: PriceData[];
  private currentIndex: number = 0;
  private connection: Connection;
  private payer: Keypair;

  constructor(config: LagInjectorConfig, connection: Connection, payer: Keypair) {
    this.oracleUtils = new OracleUtils(config.oraclePubkey, connection);
    this.lagSlots = config.lagSlots;
    this.replaySeries = [...config.replaySeries];
    this.connection = connection;
    this.payer = payer;
  }

  async injectLag(currentSlot: number): Promise<void> {
    if (this.currentIndex >= this.replaySeries.length) {
      this.currentIndex = 0; // loop for repeated testing
    }

    const priceData = this.replaySeries[this.currentIndex];
    const targetSlot = currentSlot - this.lagSlots;

    // Update oracle with lagged price (OracleUtils.setPrice handles slot internally via recent blockhash)
    await this.oracleUtils.setPrice(
      priceData.price,
      priceData.confidence,
      this.payer
    );

    this.currentIndex++;
  }

  getCurrentPrice(): number {
    if (this.replaySeries.length === 0) return 0;
    const idx = Math.max(0, this.currentIndex - 1);
    return this.replaySeries[idx].price;
  }

  reset(): void {
    this.currentIndex = 0;
  }

  // For test compatibility - matches audited export expectations
  setPrice(price: number, confidence: number = 0.01): Promise<void> {
    return this.oracleUtils.setPrice(price, confidence, this.payer);
  }
}

// Convenience factory matching expected usage pattern
export async function createLagInjector(
  oraclePubkey: PublicKey,
  lagSlots: number,
  replaySeries: PriceData[],
  connection: Connection,
  payer: Keypair
): Promise<LagInjector> {
  const config: LagInjectorConfig = {
    oraclePubkey,
    lagSlots,
    replaySeries,
  };
  return new LagInjector(config, connection, payer);
}
