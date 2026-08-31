import { Connection, PublicKey } from "@solana/web3.js";

// ------------------------------------------------------------------
// Lag injector: replays prices into the sim with a configurable slot
// lag (models the ~45s oracle lag observed during Jito depegs).
// Pure in-memory implementation driven by tick-runner; the on-chain
// oracle write path lives in oracle-utils and is wired in by the
// validator harness, not by the type-check path.
// ------------------------------------------------------------------

export interface LagInjector {
  connection: Connection;
  oracle: PublicKey;
  lagSlots: number;
  priceHistory: Array<{ price: number; slot: number }>;
  latestLaggedPrice: number;
}

export function createLagInjector(
  connection: Connection,
  oracle: PublicKey,
  lagSlots: number
): LagInjector {
  return {
    connection,
    oracle,
    lagSlots,
    priceHistory: [],
    latestLaggedPrice: 1.0,
  };
}

export async function injectLagPrice(
  injector: LagInjector,
  price: number,
  slot: number
): Promise<number> {
  // Record the real-time price
  injector.priceHistory.push({ price, slot });

  // Find the lagged price (lagSlots ago); fall back to oldest known
  const targetSlot = slot - injector.lagSlots;
  let laggedPrice = injector.priceHistory[0]?.price ?? price;

  for (let i = injector.priceHistory.length - 1; i >= 0; i--) {
    if (injector.priceHistory[i].slot <= targetSlot) {
      laggedPrice = injector.priceHistory[i].price;
      break;
    }
  }

  injector.latestLaggedPrice = laggedPrice;

  // Trim old history to keep memory reasonable
  if (injector.priceHistory.length > 10000) {
    injector.priceHistory = injector.priceHistory.slice(-5000);
  }

  return laggedPrice;
}
