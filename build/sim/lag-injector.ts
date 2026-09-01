import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TestOracle, PriceData } from "./oracle-utils";

export interface OracleConfig {
  oracle: PublicKey;
  price: number;
  confidence: number;
  timestamp: number;
}

export class LagInjector {
  private connection: Connection;
  private oracle: TestOracle;
  private lagSlots: number;
  private priceHistory: PriceData[] = [];

  constructor(
    connection: Connection,
    oraclePubkey: PublicKey,
    lagSeconds: number = 45
  ) {
    this.connection = connection;
    this.oracle = new TestOracle(oraclePubkey);
    this.lagSlots = Math.floor((lagSeconds * 2)); // ~2 slots per second on local validator
  }

  async loadHistory(prices: OracleConfig[]): Promise<void> {
    this.priceHistory = prices.map((p, i) => ({
      price: p.price,
      confidence: p.confidence,
      timestamp: p.timestamp,
      // no slot field per oracle-utils
    }));
  }

  async injectWithLag(currentSlot: number): Promise<void> {
    const lagIndex = Math.max(0, this.priceHistory.length - this.lagSlots - 1);
    if (lagIndex >= this.priceHistory.length) return;

    const delayedPrice = this.priceHistory[lagIndex];
    await this.oracle.setPrice(
      this.connection,
      delayedPrice.price,
      delayedPrice.confidence,
      delayedPrice.timestamp
    );
  }

  getCurrentLag(): number {
    return this.lagSlots;
  }
}

// Helper to replay last three Jito depeg series (example data - real replay would load from JSON)
export async function replayJitoDepegSeries(
  connection: Connection,
  oraclePubkey: PublicKey,
  lagSeconds: number = 45
): Promise<LagInjector> {
  const injector = new LagInjector(connection, oraclePubkey, lagSeconds);

  // Simulated last three depeg price series (price in USD * 1e9 for onchain precision)
  const series: OracleConfig[] = [
    { oracle: oraclePubkey, price: 0.92 * 1e9, confidence: 0.01 * 1e9, timestamp: Date.now() / 1000 - 180 },
    { oracle: oraclePubkey, price: 0.85 * 1e9, confidence: 0.02 * 1e9, timestamp: Date.now() / 1000 - 120 },
    { oracle: oraclePubkey, price: 0.78 * 1e9, confidence: 0.03 * 1e9, timestamp: Date.now() / 1000 - 60 },
    { oracle: oraclePubkey, price: 0.95 * 1e9, confidence: 0.01 * 1e9, timestamp: Date.now() / 1000 - 30 },
    { oracle: oraclePubkey, price: 0.99 * 1e9, confidence: 0.005 * 1e9, timestamp: Date.now() / 1000 },
  ];

  await injector.loadHistory(series);
  return injector;
}
