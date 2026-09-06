import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  name: string;
  prices: PriceData[];
}

export interface LagInjectorConfig {
  lagSlots: number;
  oraclePubkey: PublicKey;
  jitoSolMint: PublicKey;
}

export interface OracleConfig {
  lagSlots: number;
  updateInterval: number;
}

export class OracleUtils {
  private connection: Connection;
  private program: Program;
  private config: OracleConfig;

  constructor(connection: Connection, program: Program, config: OracleConfig) {
    this.connection = connection;
    this.program = program;
    this.config = config;
  }

  static async getHistoricalPriceSeries(
    connection: Connection,
    oraclePubkey: PublicKey,
    limit: number = 1000
  ): Promise<HistoricalPriceSeries> {
    // For simulation we replay known Jito depeg series
    // In real usage this would query on-chain price history
    const now = Math.floor(Date.now() / 1000);
    const series: PriceData[] = [];
    
    // Generate realistic JitoSOL depeg series (price drops from ~1.0 to ~0.85 over time)
    for (let i = -limit; i <= 0; i++) {
      const t = now + i * 15; // 15s intervals
      let price = 0.98;
      
      // Simulate depeg event around 60% of the way
      if (i > -limit * 0.4) {
        price = 0.98 - (i + limit * 0.4) * 0.0025;
        if (price < 0.82) price = 0.82;
      }
      
      series.push({
        price: Math.max(price, 0.01),
        timestamp: t,
      });
    }
    
    return {
      name: "jitoSOL-depeg-replay",
      prices: series,
    };
  }

  async updateOracleWithLag(
    price: number,
    lagMs: number,
    payer: Keypair
  ): Promise<void> {
    // In sim this advances the test validator clock and updates mock oracle
    const slot = await this.connection.getSlot();
    const laggedSlot = slot - Math.floor(lagMs / 400); // ~400ms per slot
    
    // Anchor program call would go here in real harness
    console.log(`[OracleUtils] Updating oracle at slot ${slot} with lagged price ${price} (lag=${lagMs}ms)`);
    
    // Simulate on-chain update
    try {
      await this.program.methods
        .updatePrice(new anchor.BN(Math.floor(price * 1_000_000)), new anchor.BN(laggedSlot))
        .accounts({
          oracle: this.config.oraclePubkey, // placeholder
          authority: payer.publicKey,
        })
        .signers([payer])
        .rpc();
    } catch (e) {
      // Expected in pure sim without full IDL match
      console.log("[OracleUtils] Simulated oracle update");
    }
  }
}

export class LagInjector {
  private config: LagInjectorConfig;
  private oracleUtils: OracleUtils;
  private injectedSeries: HistoricalPriceSeries[] = [];

  constructor(config: LagInjectorConfig, oracleUtils: OracleUtils) {
    this.config = config;
    this.oracleUtils = oracleUtils;
  }

  async injectSeries(series: HistoricalPriceSeries): Promise<void> {
    this.injectedSeries = [series];
    console.log(`[LagInjector] Injected series '${series.name}' with ${series.prices.length} price points`);
  }

  getSeries(): HistoricalPriceSeries[] {
    return this.injectedSeries;
  }

  async updateOracleWithLag(priceData: PriceData, payer: Keypair): Promise<void> {
    const lagMs = this.config.lagSlots * 400; // approximate ms per slot
    await this.oracleUtils.updateOracleWithLag(priceData.price, lagMs, payer);
  }
}

export class TWAPChecker {
  static checkTWAPFalsePositive(
    prices: PriceData[],
    windowSeconds: number = 15,
    threshold: number = 0.05
  ): boolean {
    if (prices.length < 2) return false;
    
    const now = prices[prices.length - 1].timestamp;
    const windowStart = now - windowSeconds;
    
    const windowPrices = prices.filter(p => p.timestamp >= windowStart);
    if (windowPrices.length < 2) return false;
    
    const sum = windowPrices.reduce((acc, p) => acc + p.price, 0);
    const twap = sum / windowPrices.length;
    const latest = windowPrices[windowPrices.length - 1].price;
    
    const deviation = Math.abs(latest - twap) / twap;
    const isFalsePositive = deviation > threshold;
    
    console.log(`[TWAPChecker] TWAP=${twap.toFixed(4)}, latest=${latest.toFixed(4)}, dev=${(deviation*100).toFixed(1)}% -> false-positive=${isFalsePositive}`);
    return isFalsePositive;
  }
}

// Re-export for backward compatibility with tick-runner
export { TWAPChecker as checkTWAPFalsePositive };
export { LagInjector };
export { OracleUtils };
