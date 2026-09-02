import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";

// Minimal PriceData interface used by checker and runner (no slot, no confidence)
export interface PriceData {
  price: number;
  timestamp: number;
}

export class TestOracle {
  private prices: PriceData[] = [];
  private lagSlots: number = 45; // target 45s lag at ~0.4s/slot
  private currentSlot: number = 0;

  constructor() {}

  // Load the last three Jito depeg series (hard-coded replay data for sim)
  loadDepegSeries(): void {
    // Simulated recent JitoSOL depeg price series (price in USD, timestamp in seconds)
    // Three short "depeg events" with realistic drops
    this.prices = [
      // Series 1: mild depeg
      { price: 0.98, timestamp: 1000 },
      { price: 0.95, timestamp: 1010 },
      { price: 0.92, timestamp: 1020 },
      { price: 0.89, timestamp: 1030 },
      { price: 0.95, timestamp: 1040 },
      // Series 2: sharper drop
      { price: 0.85, timestamp: 2000 },
      { price: 0.78, timestamp: 2015 },
      { price: 0.72, timestamp: 2030 },
      { price: 0.88, timestamp: 2050 },
      // Series 3: recovery after depeg
      { price: 0.65, timestamp: 3000 },
      { price: 0.75, timestamp: 3020 },
      { price: 0.92, timestamp: 3050 },
      { price: 0.98, timestamp: 3070 },
      { price: 1.00, timestamp: 3100 },
    ];
  }

  setLag(lagSeconds: number): void {
    this.lagSlots = Math.floor(lagSeconds / 0.4); // approximate slots
  }

  // Advance internal clock and return observable price at (current - lag)
  tick(): PriceData | null {
    this.currentSlot += 1;
    const laggedSlot = this.currentSlot - this.lagSlots;
    const laggedTime = laggedSlot * 0.4 + 1000; // base offset for replay

    // Find closest price point at or before lagged time
    let best: PriceData | null = null;
    for (const p of this.prices) {
      if (p.timestamp <= laggedTime) {
        if (!best || p.timestamp > best.timestamp) {
          best = p;
        }
      } else {
        break;
      }
    }
    return best;
  }

  // Public API expected by tick-runner (no extra args)
  getLatestPrice(): PriceData | null {
    return this.tick();
  }

  // Compatibility alias used by older runner calls
  injectLag(lagSeconds: number): void {
    this.setLag(lagSeconds);
  }

  // Reset for repeated sim runs
  reset(): void {
    this.currentSlot = 0;
  }
}

// Utility to create a real on-chain oracle account (stubbed for local test validator)
export async function createTestOracleAccount(
  connection: Connection,
  payer: anchor.web3.Keypair,
  programId: PublicKey
): Promise<PublicKey> {
  // In pure-onchain sim we just return a deterministic PDA; real deployment would init here
  const [oraclePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), Buffer.from("jitoSOL")],
    programId
  );
  return oraclePda;
}
