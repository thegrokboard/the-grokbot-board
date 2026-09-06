import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

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
  slotDurationMs: number;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  updateAuthority: PublicKey;
  priceFeed: string;
}

export class OracleUtils {
  static createLagInjectorConfig(lagSlots: number = 225, targetLagMs: number = 45000, slotDurationMs: number = 200): LagInjectorConfig {
    return { lagSlots, targetLagMs, slotDurationMs };
  }

  static getHistoricalPriceSeries(asset: string = "jitoSOL", limit: number = 1000): HistoricalPriceSeries {
    // In real sim this would load from fixture; here we return empty for type safety.
    // lag-injector and tick-runner will replace with replay data.
    return { prices: [], asset };
  }

  static createOracleConfig(oraclePubkey: PublicKey, updateAuthority: PublicKey, priceFeed: string = "jitoSOL"): OracleConfig {
    return { oraclePubkey, updateAuthority, priceFeed };
  }

  static calculateTWAP(prices: PriceData[], windowSeconds: number = 15): number {
    if (prices.length === 0) return 0;
    const now = Date.now() / 1000;
    const cutoff = now - windowSeconds;
    const recent = prices.filter(p => p.timestamp >= cutoff);
    if (recent.length === 0) return prices[prices.length - 1].price;
    const sum = recent.reduce((acc, p) => acc + p.price, 0);
    return sum / recent.length;
  }

  static injectLag(series: HistoricalPriceSeries, lagSlots: number, currentSlot: number): PriceData | null {
    const effectiveIndex = Math.max(0, series.prices.length - 1 - lagSlots);
    if (effectiveIndex >= series.prices.length) return null;
    return { ...series.prices[effectiveIndex] };
  }
}

export default OracleUtils;
