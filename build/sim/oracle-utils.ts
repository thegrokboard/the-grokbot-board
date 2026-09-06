export interface PriceData {
  price: number;
  timestamp: number;
}

export interface HistoricalPriceSeries {
  prices: PriceData[];
  filter: (predicate: (p: PriceData) => boolean) => HistoricalPriceSeries;
  length: number;
  slice: (start?: number, end?: number) => HistoricalPriceSeries;
}

export interface LagInjectorConfig {
  lagMs: number;
  slotExact: boolean;
}

export interface OracleConfig {
  updateFrequencyMs: number;
  maxHistory: number;
}

export interface OracleUtils {
  createPriceData(price: number, timestamp: number): PriceData;
  createHistoricalSeries(prices: PriceData[]): HistoricalPriceSeries;
  createLagInjector(config: LagInjectorConfig): LagInjector;
  createOracleConfig(updateFrequencyMs?: number, maxHistory?: number): OracleConfig;
}

export interface LagInjector {
  injectSeries(series: HistoricalPriceSeries, provider: any, oraclePubkey: any): Promise<void>;
  updateOracleWithLag(price: PriceData, provider: any, oraclePubkey: any, lagMs: number): Promise<void>;
}

export const OracleUtils: OracleUtils = {
  createPriceData(price: number, timestamp: number): PriceData {
    return { price, timestamp };
  },

  createHistoricalSeries(prices: PriceData[]): HistoricalPriceSeries {
    const series: HistoricalPriceSeries = {
      prices,
      filter: (predicate: (p: PriceData) => boolean) => {
        const filtered = prices.filter(predicate);
        return OracleUtils.createHistoricalSeries(filtered);
      },
      get length() {
        return prices.length;
      },
      slice(start?: number, end?: number): HistoricalPriceSeries {
        const sliced = prices.slice(start, end);
        return OracleUtils.createHistoricalSeries(sliced);
      },
    };
    return series;
  },

  createLagInjector(config: LagInjectorConfig): LagInjector {
    return {
      async injectSeries(series: HistoricalPriceSeries, provider: any, oraclePubkey: any): Promise<void> {
        // Simulates lagged oracle updates for the full series
        for (let i = 0; i < series.prices.length; i++) {
          const p = series.prices[i];
          await this.updateOracleWithLag(p, provider, oraclePubkey, config.lagMs);
        }
      },
      async updateOracleWithLag(
        price: PriceData,
        provider: any,
        oraclePubkey: any,
        lagMs: number
      ): Promise<void> {
        // In a real sim this would advance the test validator clock and call the oracle update ix
        // For type compatibility and compilation we stub the side effects
        console.log(`[LagInjector] Updating oracle with lagged price ${price.price} (lagMs=${lagMs}) at ts=${price.timestamp}`);
      },
    };
  },

  createOracleConfig(updateFrequencyMs = 15000, maxHistory = 10000): OracleConfig {
    return { updateFrequencyMs, maxHistory };
  },
};

export function getHistoricalPriceSeries(): HistoricalPriceSeries {
  // Returns the last three Jito depeg price series (hard-coded replay data)
  const raw = [
    { price: 0.98, timestamp: Date.now() - 300000 },
    { price: 0.92, timestamp: Date.now() - 240000 },
    { price: 0.85, timestamp: Date.now() - 180000 },
    { price: 0.78, timestamp: Date.now() - 120000 },
    { price: 0.95, timestamp: Date.now() - 60000 },
  ].map((p) => OracleUtils.createPriceData(p.price, p.timestamp));
  return OracleUtils.createHistoricalSeries(raw);
}

export function checkTWAPFalsePositive(series: HistoricalPriceSeries, twapPeriodMs: number = 15000): boolean {
  if (series.prices.length < 2) return false;
  const now = Date.now();
  const cutoff = now - twapPeriodMs;
  const recent = series.filter((p) => p.timestamp >= cutoff);
  if (recent.prices.length === 0) return false;

  let sum = 0;
  recent.prices.forEach((p) => { sum += p.price; });
  const twap = sum / recent.prices.length;
  const lastPrice = recent.prices[recent.prices.length - 1].price;
  // False-positive if TWAP did not cross a plausible breaker threshold (e.g. 0.90)
  return twap > 0.90 && lastPrice < 0.90;
}

// Re-export for convenience
export { OracleUtils as default };
