import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { readFileSync } from "fs";
import { join } from "path";

export interface PriceTick {
  slot: number;
  price: number; // jitoSOL price in USD (e.g. 0.92)
  timestamp: number;
}

export interface JitoDepegSeries {
  ticks: PriceTick[];
  startSlot: number;
  description: string;
}

// Path to the replay data (assumed to be committed or generated; for sim we use a minimal synthetic dataset)
const DATA_PATH = join(__dirname, "jito-depeg-series.json");

// Minimal synthetic 3-series dataset for the sim (real data would be loaded from file)
function getSyntheticSeries(): JitoDepegSeries[] {
  return [
    {
      ticks: [
        { slot: 100, price: 1.00, timestamp: 1720000000 },
        { slot: 110, price: 0.98, timestamp: 1720000010 },
        { slot: 120, price: 0.95, timestamp: 1720000020 },
        { slot: 130, price: 0.88, timestamp: 1720000030 },
        { slot: 140, price: 0.85, timestamp: 1720000040 },
      ],
      startSlot: 100,
      description: "Series 1 - mild depeg",
    },
    {
      ticks: [
        { slot: 200, price: 1.00, timestamp: 1720100000 },
        { slot: 210, price: 0.97, timestamp: 1720100010 },
        { slot: 220, price: 0.94, timestamp: 1720100020 },
        { slot: 230, price: 0.91, timestamp: 1720100030 },
      ],
      startSlot: 200,
      description: "Series 2 - moderate depeg",
    },
    {
      ticks: [
        { slot: 300, price: 1.00, timestamp: 1720200000 },
        { slot: 310, price: 0.99, timestamp: 1720200010 },
        { slot: 320, price: 0.96, timestamp: 1720200020 },
        { slot: 330, price: 0.93, timestamp: 1720200030 },
        { slot: 340, price: 0.89, timestamp: 1720200040 },
      ],
      startSlot: 300,
      description: "Series 3 - sharp depeg",
    },
  ];
}

export function loadJitoDepegSeries(): JitoDepegSeries[] {
  try {
    const raw = readFileSync(DATA_PATH, "utf-8");
    return JSON.parse(raw) as JitoDepegSeries[];
  } catch (e) {
    // fallback to synthetic for CI/sim when data file is absent
    console.warn("Could not load jito-depeg-series.json, using synthetic data");
    return getSyntheticSeries();
  }
}

export function getPriceAtSlot(series: JitoDepegSeries, targetSlot: number): number | null {
  const sorted = [...series.ticks].sort((a, b) => a.slot - b.slot);
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].slot <= targetSlot) {
      return sorted[i].price;
    }
  }
  return null;
}

export async function createTestProvider(): Promise<anchor.AnchorProvider> {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const wallet = new anchor.Wallet(Keypair.generate());
  return new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

export function getVaultProgramId(): PublicKey {
  // Default Anchor program ID for vault (updated via anchor keys after build)
  return new PublicKey("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");
}
