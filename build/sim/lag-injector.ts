import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { OracleUtils, PriceData } from "./oracle-utils";

export interface LagInjectorConfig {
  lagSlots: number;
  oraclePubkey: PublicKey;
  payer: Keypair;
}

export class LagInjector {
  private connection: Connection;
  private oracleUtils: OracleUtils;
  private lagSlots: number;
  private priceHistory: PriceData[] = [];
  private oraclePubkey: PublicKey;
  private payer: Keypair;

  constructor(connection: Connection, config: LagInjectorConfig) {
    this.connection = connection;
    this.lagSlots = config.lagSlots;
    this.oraclePubkey = config.oraclePubkey;
    this.payer = config.payer;
    this.oracleUtils = new OracleUtils(connection, config.oraclePubkey);
  }

  async loadPriceHistory(prices: PriceData[]): Promise<void> {
    this.priceHistory = [...prices];
  }

  async injectNextPrice(currentSlot: number): Promise<void> {
    const effectiveSlot = currentSlot - this.lagSlots;
    const priceToInject = this.priceHistory.find(p => p.slot <= effectiveSlot);
    if (!priceToInject) {
      console.warn(`No price data available for slot ${effectiveSlot}`);
      return;
    }

    await this.oracleUtils.setPrice(priceToInject.price, this.payer);
    console.log(`Injected lagged price ${priceToInject.price} at slot ${currentSlot} (effective ${effectiveSlot})`);
  }

  getCurrentLag(): number {
    return this.lagSlots;
  }

  setLag(newLag: number): void {
    this.lagSlots = newLag;
  }
}

// Export the exact function signature expected by tick-runner
export async function replayWithLag(
  connection: Connection,
  prices: PriceData[],
  lagSlots: number,
  oraclePubkey: PublicKey,
  payer: Keypair
): Promise<LagInjector> {
  const injector = new LagInjector(connection, { lagSlots, oraclePubkey, payer });
  await injector.loadPriceHistory(prices);
  return injector;
}
