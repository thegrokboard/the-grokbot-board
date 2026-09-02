import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import fs from "fs";

// -----------------------------
// Types (consistent across sim)
// -----------------------------

export interface PriceData {
  price: number;
  confidence: number;
  timestamp: number;
}

export interface TWAPConfig {
  windowSeconds: number;
  thresholdPercent: number;
  minSamples: number;
}

export class TestOracle {
  public readonly pubkey: PublicKey;
  private prices: PriceData[] = [];
  private currentSlot = 0;
  private lagSlots = 90; // ~45s at 500ms/slot

  constructor(pubkey: PublicKey) {
    this.pubkey = pubkey;
  }

  setLag(lagSeconds: number): void {
    this.lagSlots = Math.floor(lagSeconds * 2); // rough 2 slots per second
  }

  pushPrice(price: number, confidence: number = 0.01, timestamp?: number): void {
    const ts = timestamp ?? Math.floor(Date.now() / 1000);
    this.prices.push({ price, confidence, timestamp: ts });
  }

  getLatestPrice(): PriceData | null {
    if (this.prices.length === 0) return null;
    return this.prices[this.prices.length - 1];
  }

  getPriceAtSlot(slot: number): PriceData | null {
    // simulate lag
    const laggedSlot = Math.max(0, slot - this.lagSlots);
    for (let i = this.prices.length - 1; i >= 0; i--) {
      // simplistic: return most recent price before lagged slot
      if (this.prices[i].timestamp <= laggedSlot * 0.5 + 100) {
        return this.prices[i];
      }
    }
    return this.getLatestPrice();
  }

  advanceSlot(slots: number = 1): void {
    this.currentSlot += slots;
  }

  getCurrentSlot(): number {
    return this.currentSlot;
  }
}

// -----------------------------
// Exported utilities
// -----------------------------

export function advanceToSlot(
  oracle: TestOracle,
  targetSlot: number
): void {
  const current = oracle.getCurrentSlot();
  if (targetSlot > current) {
    oracle.advanceSlot(targetSlot - current);
  }
}

export function getVaultProgram(
  provider: anchor.Provider
): anchor.Program {
  // In real Anchor test the program is loaded via workspace; stubbed here for sim
  const idl = JSON.parse(fs.readFileSync("./target/idl/vault.json", "utf8"));
  return new anchor.Program(idl, new PublicKey("Vault111111111111111111111111111111111111111"), provider);
}

export async function loadJitoPriceHistory(
  filePath: string = "./sim/jito-price-history.json"
): Promise<PriceData[]> {
  if (!fs.existsSync(filePath)) {
    // fallback synthetic depeg series (last three known rough JitoSOL depegs)
    return [
      { price: 0.98, confidence: 0.005, timestamp: 1700000000 },
      { price: 0.95, confidence: 0.008, timestamp: 1700000100 },
      { price: 0.88, confidence: 0.012, timestamp: 1700000300 },
      { price: 0.75, confidence: 0.015, timestamp: 1700000600 },
      { price: 0.92, confidence: 0.006, timestamp: 1700001200 },
      { price: 0.97, confidence: 0.004, timestamp: 1700001800 },
    ];
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return raw.map((p: any) => ({
    price: p.price,
    confidence: p.confidence ?? 0.01,
    timestamp: p.timestamp,
  }));
}

export function computeTWAP(
  prices: PriceData[],
  config: TWAPConfig
): number {
  if (prices.length < config.minSamples) return 0;
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - config.windowSeconds;
  const recent = prices.filter(p => p.timestamp >= cutoff);
  if (recent.length === 0) return 0;

  let sum = 0;
  recent.forEach(p => { sum += p.price; });
  return sum / recent.length;
}

export function checkTWAPFalsePositive(
  prices: PriceData[],
  config: TWAPConfig = { windowSeconds: 15, thresholdPercent: 8, minSamples: 3 }
): boolean {
  const twap = computeTWAP(prices, config);
  if (twap === 0) return false;
  const latest = prices[prices.length - 1].price;
  const deviation = Math.abs(latest - twap) / twap * 100;
  return deviation < config.thresholdPercent;
}

export function createTestOracle(): TestOracle {
  return new TestOracle(new PublicKey("TestOracle111111111111111111111111111111"));
}
