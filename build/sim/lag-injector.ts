import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { OracleUtils, PriceData } from "./oracle-utils";
import { getHistoricalJitoPrices } from "./oracle-utils";

export interface LagInjectorConfig {
  lagSeconds: number;
  startSlot?: number;
  oracleProgramId: PublicKey;
  priceFeed: PublicKey;
}

export class LagInjector {
  private connection: Connection;
  private oracleUtils: OracleUtils;
  private lagSeconds: number;
  private historicalPrices: PriceData[] = [];
  private startSlot: number = 0;
  private currentIndex: number = 0;
  private oracleProgramId: PublicKey;
  private priceFeed: PublicKey;

  constructor(config: LagInjectorConfig, connection: Connection) {
    this.connection = connection;
    this.lagSeconds = config.lagSeconds;
    this.oracleProgramId = config.oracleProgramId;
    this.priceFeed = config.priceFeed;
    this.oracleUtils = new OracleUtils(connection, config.oracleProgramId);
    this.startSlot = config.startSlot || 0;
  }

  async init(): Promise<void> {
    this.historicalPrices = await getHistoricalJitoPrices();
    if (this.historicalPrices.length === 0) {
      throw new Error("No historical Jito prices available");
    }
    // Ensure all prices have timestamps
    this.historicalPrices = this.historicalPrices.map((p, i) => ({
      ...p,
      timestamp: p.timestamp || Math.floor(Date.now() / 1000) - (this.historicalPrices.length - i) * 5,
      slot: p.slot || this.startSlot + i * 2,
    }));
    this.currentIndex = 0;
  }

  async injectPriceAtSlot(targetSlot: number): Promise<void> {
    if (this.historicalPrices.length === 0) {
      await this.init();
    }

    const lagSlots = Math.floor(this.lagSeconds * 2); // ~2 slots per second on test validator
    const effectiveSlot = Math.max(targetSlot - lagSlots, this.startSlot);
    
    // Find the price that would have been observed lagSlots ago
    let index = this.currentIndex;
    while (index < this.historicalPrices.length - 1 && this.historicalPrices[index].slot < effectiveSlot) {
      index++;
    }
    this.currentIndex = Math.min(index, this.historicalPrices.length - 1);

    const priceData = this.historicalPrices[this.currentIndex];

    await this.oracleUtils.updatePriceFeed(
      this.priceFeed,
      priceData.price,
      priceData.confidence,
      priceData.slot,
      priceData.timestamp
    );
  }

  getCurrentLagPrice(): PriceData | null {
    if (this.historicalPrices.length === 0 || this.currentIndex >= this.historicalPrices.length) {
      return null;
    }
    return this.historicalPrices[this.currentIndex];
  }

  reset(): void {
    this.currentIndex = 0;
  }
}

// Default config for JitoSOL depeg sim (45s target lag)
export function createDefaultLagInjector(connection: Connection): LagInjector {
  return new LagInjector({
    lagSeconds: 45,
    oracleProgramId: new PublicKey("oracle1111111111111111111111111111111111111111"), // placeholder for sim
    priceFeed: new PublicKey("jitoSOLPriceFeed1111111111111111111111111111111"),
  }, connection);
}
