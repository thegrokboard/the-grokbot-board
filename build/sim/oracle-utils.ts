import * as anchor from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

// =============================================================================
// Shared types - single source of truth (no external modules)
// =============================================================================

export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  name: string;
}

export interface LagInjectorConfig {
  lagMs: number;
  lagSlots: number;
  oraclePubkey: PublicKey;
  jitoSolMint: PublicKey;
}

export interface OracleConfig {
  oraclePubkey: PublicKey;
  updateFrequencyMs: number;
}

export interface TWAPConfig {
  windowMs: number;
  thresholdBps: number;
}

export interface VaultState {
  owner: PublicKey;
  paused: boolean;
  protectionBuffer: number;
  drawdownBps: number;
}

// =============================================================================
// Oracle utilities namespace
// =============================================================================

export const OracleUtils = {
  // Factory for config
  createLagInjectorConfig(
    lagMs: number,
    lagSlots: number,
    oraclePubkey: PublicKey,
    jitoSolMint: PublicKey
  ): LagInjectorConfig {
    return {
      lagMs,
      lagSlots,
      oraclePubkey,
      jitoSolMint,
    };
  },

  createOracleConfig(oraclePubkey: PublicKey): OracleConfig {
    return {
      oraclePubkey,
      updateFrequencyMs: 15000,
    };
  },

  createTWAPConfig(): TWAPConfig {
    return {
      windowMs: 15000,
      thresholdBps: 500, // 5%
    };
  },

  // Price helpers
  priceToScaled(price: number): number {
    return Math.floor(price * 1_000_000);
  },

  scaledToPrice(scaled: number): number {
    return scaled / 1_000_000;
  },

  // Simulate a price update instruction (for test validator replay)
  createUpdatePriceInstruction(
    oraclePubkey: PublicKey,
    priceData: PriceData,
    programId: PublicKey
  ): TransactionInstruction {
    const data = Buffer.from(
      Uint8Array.of(
        1, // discriminator for update
        ...new anchor.BN(OracleUtils.priceToScaled(priceData.price)).toArray("le", 8),
        ...new anchor.BN(priceData.timestamp).toArray("le", 8)
      )
    );

    return new TransactionInstruction({
      keys: [
        { pubkey: oraclePubkey, isSigner: false, isWritable: true },
        { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId,
      data,
    });
  },

  // TWAP calculation (15s window false-positive checker)
  computeTWAP(prices: PriceData[], windowMs: number): number {
    if (prices.length === 0) return 0;

    const now = Date.now();
    const cutoff = now - windowMs;

    const recent = prices.filter((p) => p.timestamp >= cutoff);
    if (recent.length === 0) return prices[prices.length - 1].price;

    const sum = recent.reduce((acc, p) => acc + p.price, 0);
    return sum / recent.length;
  },

  // Check for false positive drawdown
  checkTWAPFalsePositive(
    series: HistoricalPriceSeries,
    twapConfig: TWAPConfig,
    currentPrice: number
  ): boolean {
    const twap = OracleUtils.computeTWAP(series.prices, twapConfig.windowMs);
    const diffBps = Math.abs((currentPrice - twap) / twap) * 10000;
    return diffBps < twapConfig.thresholdBps;
  },

  // Lag helpers
  calculateLagSlots(lagMs: number, slotTimeMs: number = 400): number {
    return Math.floor(lagMs / slotTimeMs);
  },

  // Filter series (for replay)
  filterSeries(series: HistoricalPriceSeries, startTime: number, endTime: number): HistoricalPriceSeries {
    const filteredPrices = series.prices.filter(
      (p) => p.timestamp >= startTime && p.timestamp <= endTime
    );
    return {
      ...series,
      prices: filteredPrices,
    };
  },

  // Create mock JitoSOL depeg series (last three depegs for replay)
  createMockJitoDepegSeries(): HistoricalPriceSeries[] {
    const baseTime = Date.now() - 3600_000; // 1 hour ago
    const series: HistoricalPriceSeries[] = [];

    // Series 1: mild depeg
    const s1: PriceData[] = [];
    for (let i = 0; i < 30; i++) {
      const t = baseTime + i * 30000;
      let p = 1.0;
      if (i > 10 && i < 20) p = 0.92;
      s1.push({ price: p, timestamp: t });
    }
    series.push({ prices: s1, name: "mild-depeg" });

    // Series 2: sharp depeg
    const s2: PriceData[] = [];
    for (let i = 0; i < 45; i++) {
      const t = baseTime + 900000 + i * 20000;
      let p = 1.0;
      if (i > 8 && i < 25) p = 0.78;
      s2.push({ price: p, timestamp: t });
    }
    series.push({ prices: s2, name: "sharp-depeg" });

    // Series 3: recovery
    const s3: PriceData[] = [];
    for (let i = 0; i < 35; i++) {
      const t = baseTime + 1800000 + i * 25000;
      let p = 0.85;
      if (i > 15) p = 0.97;
      s3.push({ price: p, timestamp: t });
    }
    series.push({ prices: s3, name: "recovery" });

    return series;
  },
};

// Re-export for convenience
export { PriceData, HistoricalPriceSeries, LagInjectorConfig, OracleConfig, TWAPConfig, VaultState };
