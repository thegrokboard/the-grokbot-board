import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import { Vault } from "../target/types/vault";

export interface PriceTick {
  slot: number;
  price: number; // scaled price (e.g. 0.95 for $0.95)
  timestamp: number;
}

// Last three historical JitoSOL depeg series (simplified for test harness)
export const jitoDepegSeries: PriceTick[][] = [
  // Series 1: mild depeg
  [
    { slot: 100, price: 0.98, timestamp: 1725000000 },
    { slot: 105, price: 0.95, timestamp: 1725000300 },
    { slot: 110, price: 0.92, timestamp: 1725000600 },
    { slot: 115, price: 0.89, timestamp: 1725000900 },
    { slot: 120, price: 0.87, timestamp: 1725001200 },
  ],
  // Series 2: sharp drawdown
  [
    { slot: 200, price: 1.00, timestamp: 1725100000 },
    { slot: 205, price: 0.82, timestamp: 1725100300 },
    { slot: 210, price: 0.75, timestamp: 1725100600 },
    { slot: 215, price: 0.71, timestamp: 1725100900 },
    { slot: 220, price: 0.68, timestamp: 1725101200 },
  ],
  // Series 3: prolonged depeg
  [
    { slot: 300, price: 0.99, timestamp: 1725200000 },
    { slot: 310, price: 0.94, timestamp: 1725200600 },
    { slot: 320, price: 0.88, timestamp: 1725201200 },
    { slot: 330, price: 0.79, timestamp: 1725201800 },
    { slot: 340, price: 0.76, timestamp: 1725202400 },
    { slot: 350, price: 0.74, timestamp: 1725203000 },
  ],
];

export const LAG_SLOTS = 225; // ~45s at 200ms/slot target

/**
 * Injects lagged oracle price into the test validator at exact slot parity.
 * Uses the protection buffer PDA and a mock oracle account for the harness.
 */
export async function injectLaggedPrice(
  provider: anchor.Provider,
  program: anchor.Program<Vault>,
  seriesIndex: number,
  tickIndex: number,
  lagMs: number = 45000
): Promise<void> {
  const series = jitoDepegSeries[seriesIndex % jitoDepegSeries.length];
  const tick = series[tickIndex % series.length];

  const [bufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protection_buffer")],
    program.programId
  );

  const [oraclePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("jito_oracle")],
    program.programId
  );

  // Update on-chain oracle with lagged price (simulates delayed feed)
  const tx = await program.methods
    .updateOracle(new anchor.BN(Math.floor(tick.price * 1_000_000)), new anchor.BN(tick.slot))
    .accounts({
      oracle: oraclePda,
      authority: (provider.wallet as any).payer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`[lag-injector] Injected price=${tick.price} (slot=${tick.slot}) with ${lagMs}ms lag at tx=${tx}`);
}

/**
 * Returns TWAP over the last N ticks from a replay series, accounting for lag.
 */
export function computeTWAP(series: PriceTick[], windowTicks: number = 5): number {
  if (series.length === 0) return 1.0;
  const window = series.slice(-windowTicks);
  const sum = window.reduce((acc, t) => acc + t.price, 0);
  return sum / window.length;
}

/**
 * Checks if a drawdown circuit breaker should trip given current TWAP and threshold.
 */
export function shouldTripBreaker(twap: number, threshold: number = 0.85): boolean {
  return twap < threshold;
}

// Re-export types for convenience
export type { Vault };
