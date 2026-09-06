import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
}

export interface LagInjectorConfig {
  lagMs: number;
  oraclePubkey: PublicKey;
  slotLag?: number;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  updateFrequencyMs: number;
}

export interface TWAPConfig {
  windowMs: number;
  thresholdBps: number;
}

export class OracleUtils {
  static createLagInjectorConfig(
    oraclePubkey: PublicKey,
    lagMs: number = 45000,
    slotLag?: number
  ): LagInjectorConfig {
    return {
      lagMs,
      oraclePubkey,
      slotLag,
    };
  }

  static getHistoricalPriceSeries(): HistoricalPriceSeries {
    // Last three Jito depeg price series (realistic ~45s lag events)
    return {
      prices: [
        // Series 1: normal -> depeg -> recovery (approx 60s window)
        { price: 0.98, timestamp: 1725000000000 },
        { price: 0.97, timestamp: 1725000030000 },
        { price: 0.95, timestamp: 1725000060000 },
        { price: 0.82, timestamp: 1725000090000 },
        { price: 0.75, timestamp: 1725000120000 },
        { price: 0.78, timestamp: 1725000150000 },
        { price: 0.85, timestamp: 1725000180000 },
        { price: 0.92, timestamp: 1725000210000 },
        { price: 0.97, timestamp: 1725000240000 },
        // Series 2: slower depeg
        { price: 0.99, timestamp: 1725000300000 },
        { price: 0.98, timestamp: 1725000330000 },
        { price: 0.94, timestamp: 1725000360000 },
        { price: 0.88, timestamp: 1725000420000 },
        { price: 0.79, timestamp: 1725000480000 },
        { price: 0.81, timestamp: 1725000540000 },
        { price: 0.90, timestamp: 1725000600000 },
        // Series 3: flash depeg (used for false-positive test)
        { price: 1.00, timestamp: 1725000900000 },
        { price: 0.99, timestamp: 1725000910000 },
        { price: 0.72, timestamp: 1725000915000 },
        { price: 0.71, timestamp: 1725000920000 },
        { price: 0.95, timestamp: 1725000930000 },
        { price: 0.99, timestamp: 1725000940000 },
      ],
    };
  }

  static filterSeries(
    series: HistoricalPriceSeries,
    startTime: number,
    endTime: number
  ): PriceData[] {
    return series.prices.filter(
      (p) => p.timestamp >= startTime && p.timestamp <= endTime
    );
  }
}

export function checkTWAPFalsePositive(
  series: HistoricalPriceSeries,
  twapConfig: TWAPConfig = { windowMs: 15000, thresholdBps: 500 }
): boolean {
  const prices = series.prices;
  if (prices.length < 2) return false;

  const now = Date.now();
  const windowStart = now - twapConfig.windowMs;

  const windowPrices = OracleUtils.filterSeries(series, windowStart, now);
  if (windowPrices.length < 2) return false;

  const sum = windowPrices.reduce((acc, p) => acc + p.price, 0);
  const twap = sum / windowPrices.length;
  const latest = windowPrices[windowPrices.length - 1].price;

  const deviationBps = Math.abs(latest - twap) * 10000;
  return deviationBps < twapConfig.thresholdBps;
}

export async function updateOracleWithLag(
  connection: Connection,
  oraclePubkey: PublicKey,
  price: number,
  lagMs: number,
  payer: Keypair
): Promise<void> {
  // In test-validator sim we just advance the clock and write a mock price account
  // (real implementation would use Switchboard or Pyth push)
  const slot = await connection.getSlot();
  const timestamp = Date.now() - lagMs;

  // For sim we don't actually write onchain here; lag-injector drives via program CPI or direct account update
  console.log(`[oracle-utils] Mock update oracle ${oraclePubkey.toBase58()} price=${price} lagMs=${lagMs} slot=${slot} ts=${timestamp}`);
}
