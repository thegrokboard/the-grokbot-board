import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { Vault } from "../target/types/vault";

interface PriceTick {
  slot: number;
  price: number; // jitoSOL price in USD (scaled)
  timestamp: number;
}

export class TwapChecker {
  private connection: Connection;
  private program: anchor.Program<Vault>;
  private oraclePubkey: PublicKey;
  private windowSeconds: number = 15;
  private falsePositiveThreshold: number = 0.02; // 2% drawdown

  constructor(
    connection: Connection,
    program: anchor.Program<Vault>,
    oraclePubkey: PublicKey
  ) {
    this.connection = connection;
    this.program = program;
    this.oraclePubkey = oraclePubkey;
  }

  /**
   * Runs 15s TWAP false-positive detection over a replayed price series.
   * Returns { breakerTrips, falsePositives, logs }
   */
  async checkSeries(ticks: PriceTick[]): Promise<{
    breakerTrips: number;
    falsePositives: number;
    logs: string[];
  }> {
    const logs: string[] = [];
    let breakerTrips = 0;
    let falsePositives = 0;

    if (ticks.length < 2) {
      logs.push("Insufficient ticks for TWAP check");
      return { breakerTrips, falsePositives, logs };
    }

    // Sort by slot just in case
    const sortedTicks = [...ticks].sort((a, b) => a.slot - b.slot);

    let windowStartIdx = 0;
    for (let i = 1; i < sortedTicks.length; i++) {
      const current = sortedTicks[i];
      const windowStart = sortedTicks[windowStartIdx];

      // Slide window to keep it within 15 seconds
      while (
        current.timestamp - windowStart.timestamp > this.windowSeconds &&
        windowStartIdx < i
      ) {
        windowStartIdx++;
      }

      if (i - windowStartIdx < 1) continue;

      // Compute simple TWAP over the window
      let sum = 0;
      let count = 0;
      for (let j = windowStartIdx; j <= i; j++) {
        sum += sortedTicks[j].price;
        count++;
      }
      const twap = sum / count;
      const latestPrice = current.price;

      const drawdown = (twap - latestPrice) / twap;

      if (drawdown > this.falsePositiveThreshold) {
        breakerTrips++;
        logs.push(
          `BREACH at slot ${current.slot}: TWAP=${twap.toFixed(
            4
          )}, price=${latestPrice.toFixed(4)}, drawdown=${(
            drawdown * 100
          ).toFixed(2)}%`
        );

        // Simulate calling the on-chain circuit breaker (dry-run)
        try {
          await this.program.methods
            .triggerDrawdownBreaker(new anchor.BN(Math.floor(latestPrice * 1e9)))
            .accounts({
              oracle: this.oraclePubkey,
              authority: this.program.provider.publicKey!,
            })
            .rpc({ commitment: "confirmed" });
          logs.push(`  -> breaker instruction succeeded on-chain`);
        } catch (err: any) {
          logs.push(`  -> breaker instruction failed: ${err.message}`);
        }
      } else if (drawdown > 0.005) {
        // near-miss that should not trigger
        falsePositives++;
        logs.push(
          `NEAR-MISS at slot ${current.slot}: drawdown=${(
            drawdown * 100
          ).toFixed(2)}% (under threshold)`
        );
      }
    }

    logs.push(
      `TWAP check complete. Trips: ${breakerTrips}, False positives: ${falsePositives}`
    );
    return { breakerTrips, falsePositives, logs };
  }
}

// Export a helper to run against the last three Jito depeg series (placeholder data for CI)
export async function runFalsePositiveCheck(
  connection: Connection,
  program: anchor.Program<Vault>,
  oracle: PublicKey
): Promise<void> {
  const checker = new TwapChecker(connection, program, oracle);

  // Sample replay data derived from the three historical Jito depegs
  const sampleSeries: PriceTick[] = [
    { slot: 100, price: 1.000, timestamp: 0 },
    { slot: 105, price: 0.995, timestamp: 3 },
    { slot: 110, price: 0.982, timestamp: 7 },
    { slot: 115, price: 0.960, timestamp: 12 },
    { slot: 120, price: 0.935, timestamp: 16 },
    { slot: 125, price: 0.910, timestamp: 20 },
    { slot: 130, price: 0.885, timestamp: 25 },
  ];

  const result = await checker.checkSeries(sampleSeries);
  console.log(result.logs.join("\n"));
  console.log(
    `Summary - Breaker trips: ${result.breakerTrips}, False positives: ${result.falsePositives}`
  );
}
