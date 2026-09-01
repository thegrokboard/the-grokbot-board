import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { PriceData, TestOracle } from "./oracle-utils";

export interface OracleConfig {
  oracle: PublicKey;
  feed: PublicKey;
}

export interface LagInjector {
  injectLagPrice: (lagSeconds: number, currentSlot: number, priceSeries: PriceData[]) => Promise<void>;
}

export function createLagInjector(
  provider: anchor.Provider,
  program: anchor.Program,
  config: OracleConfig
): LagInjector {
  const oracle = new TestOracle(config.oracle, provider.connection);

  async function injectLagPrice(lagSeconds: number, currentSlot: number, priceSeries: PriceData[]): Promise<void> {
    if (priceSeries.length === 0) return;

    // Replay the last three prices with configurable lag (target ~45s)
    const recentPrices = priceSeries.slice(-3);
    const slotLag = Math.floor((lagSeconds * 2)); // approx 2 slots per second on local validator

    for (const price of recentPrices) {
      const laggedSlot = Math.max(0, currentSlot - slotLag);
      await oracle.setPrice({
        price: price.price,
        confidence: price.confidence,
        timestamp: price.timestamp,
      }, laggedSlot);
    }
  }

  return { injectLagPrice };
}
