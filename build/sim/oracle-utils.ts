import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  asset: string;
}

export interface LagInjectorConfig {
  lagSlots: number;
  targetLagMs: number;
  oraclePubkey: PublicKey;
  jitoSolMint: PublicKey;
}

export interface OracleConfig {
  updateInterval: number;
  maxDrawdownBps: number;
  twapWindowSlots: number;
}

export class OracleUtils {
  static createLagInjectorConfig(
    lagSlots: number,
    targetLagMs: number,
    oraclePubkey: PublicKey,
    jitoSolMint: PublicKey
  ): LagInjectorConfig {
    return {
      lagSlots,
      targetLagMs,
      oraclePubkey,
      jitoSolMint,
    };
  }

  static getHistoricalPriceSeries(): HistoricalPriceSeries {
    // Last three Jito depeg price series (realistic sample data)
    return {
      asset: "jitoSOL",
      prices: [
        // Series 1 - minor dip
        { price: 0.98, timestamp: 1725000000 },
        { price: 0.975, timestamp: 1725000030 },
        { price: 0.97, timestamp: 1725000060 },
        { price: 0.965, timestamp: 1725000090 },
        { price: 0.96, timestamp: 1725000120 },
        { price: 0.97, timestamp: 1725000150 },
        { price: 0.98, timestamp: 1725000180 },
        // Series 2 - sharp depeg
        { price: 0.99, timestamp: 1725100000 },
        { price: 0.95, timestamp: 1725100030 },
        { price: 0.88, timestamp: 1725100060 },
        { price: 0.82, timestamp: 1725100090 },
        { price: 0.79, timestamp: 1725100120 },
        { price: 0.85, timestamp: 1725100150 },
        { price: 0.92, timestamp: 1725100180 },
        // Series 3 - prolonged drawdown
        { price: 1.0, timestamp: 1725200000 },
        { price: 0.97, timestamp: 1725200030 },
        { price: 0.94, timestamp: 1725200060 },
        { price: 0.91, timestamp: 1725200090 },
        { price: 0.89, timestamp: 1725200120 },
        { price: 0.87, timestamp: 1725200150 },
        { price: 0.88, timestamp: 1725200180 },
        { price: 0.90, timestamp: 1725200210 },
      ],
    };
  }

  static filterSeriesByTime(
    series: HistoricalPriceSeries,
    startTime: number,
    endTime: number
  ): HistoricalPriceSeries {
    return {
      asset: series.asset,
      prices: series.prices.filter(
        (p) => p.timestamp >= startTime && p.timestamp <= endTime
      ),
    };
  }
}

export function calculateTWAP(prices: PriceData[], windowSeconds: number): number {
  if (prices.length === 0) return 0;
  const now = Math.max(...prices.map((p) => p.timestamp));
  const cutoff = now - windowSeconds;
  const windowPrices = prices.filter((p) => p.timestamp >= cutoff);
  if (windowPrices.length === 0) return prices[prices.length - 1].price;
  const sum = windowPrices.reduce((acc, p) => acc + p.price, 0);
  return sum / windowPrices.length;
}

export function checkTWAPFalsePositive(
  series: HistoricalPriceSeries,
  maxDrawdownBps: number,
  twapWindowSeconds: number
): boolean {
  if (series.prices.length < 2) return false;
  const twap = calculateTWAP(series.prices, twapWindowSeconds);
  const latest = series.prices[series.prices.length - 1].price;
  const drawdownBps = Math.floor(((twap - latest) / twap) * 10000);
  return drawdownBps > maxDrawdownBps;
}

export async function updateOracleWithLag(
  connection: Connection,
  oraclePubkey: PublicKey,
  priceData: PriceData,
  lagSlots: number,
  payer: Keypair
): Promise<void> {
  // Simulate oracle update with lag (no-op in sim harness but matches expected signature)
  console.log(`[OracleUtils] Simulated lagged update to oracle ${oraclePubkey.toBase58()} with price ${priceData.price} (lag: ${lagSlots} slots)`);
  // In a real harness this would CPI to the oracle program or write to a mock account
}

export function createLagInjector(
  config: LagInjectorConfig,
  provider: anchor.Provider
): LagInjector {
  return new LagInjector(config, provider);
}

export class LagInjector {
  private config: LagInjectorConfig;
  private provider: anchor.Provider;
  private currentLag: number = 0;

  constructor(config: LagInjectorConfig, provider: anchor.Provider) {
    this.config = config;
    this.provider = provider;
  }

  async injectSeries(series: HistoricalPriceSeries, startSlot: number): Promise<void> {
    console.log(`[LagInjector] Injecting series of ${series.prices.length} prices with ${this.config.lagSlots} slot lag`);
    for (let i = 0; i < series.prices.length; i++) {
      const price = series.prices[i];
      await this.updateOracleWithLag(price, startSlot + i);
    }
  }

  async updateOracleWithLag(priceData: PriceData, slot: number): Promise<void> {
    this.currentLag = Math.max(0, this.currentLag + (this.config.lagSlots > 0 ? 1 : 0));
    const laggedSlot = slot - this.currentLag;
    await updateOracleWithLag(
      this.provider.connection,
      this.config.oraclePubkey,
      priceData,
      this.config.lagSlots,
      (this.provider as any).wallet.payer // simulation wallet
    );
    console.log(`[LagInjector] Updated oracle at simulated slot ${laggedSlot} with price ${priceData.price}`);
  }

  getCurrentLag(): number {
    return this.currentLag;
  }
}

// Named export for backward compatibility with existing imports
export const OracleUtilsClass = OracleUtils;
export { checkTWAPFalsePositive as checkTWAPFalsePositive };
