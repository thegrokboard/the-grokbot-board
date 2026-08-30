import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet, Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { Vault } from "../target/types/vault";

export interface OraclePrices {
  prices: Array<{
    timestamp: number;
    price: number; // in USD, scaled to 1e9 for precision
  }>;
}

export const JITO_SOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn");
export const PYTH_JITO_SOL_PRICE_FEED = new PublicKey("2k4h1v7X9kT9zQJ8vP5zJqK7kP5zJqK7kP5zJqK7kP"); // placeholder for sim

// Historical JitoSOL depeg series (last three observed depegs, simplified for replay)
const REPLAY_SERIES: OraclePrices = {
  prices: [
    // Series 1: minor depeg
    { timestamp: 1720000000, price: 0.98e9 },
    { timestamp: 1720000060, price: 0.95e9 },
    { timestamp: 1720000120, price: 0.92e9 },
    { timestamp: 1720000180, price: 0.89e9 },
    { timestamp: 1720000240, price: 0.95e9 },
    // Series 2: sharp depeg
    { timestamp: 1720100000, price: 0.99e9 },
    { timestamp: 1720100060, price: 0.85e9 },
    { timestamp: 1720100120, price: 0.78e9 },
    { timestamp: 1720100180, price: 0.82e9 },
    { timestamp: 1720100240, price: 0.97e9 },
    // Series 3: prolonged drawdown
    { timestamp: 1720200000, price: 1.00e9 },
    { timestamp: 1720200300, price: 0.94e9 },
    { timestamp: 1720200600, price: 0.88e9 },
    { timestamp: 1720200900, price: 0.81e9 },
    { timestamp: 1720201200, price: 0.79e9 },
    { timestamp: 1720201500, price: 0.85e9 },
  ],
};

export function getJitoSOLPrice(ts: number): number {
  // simple linear interpolation over replay data
  const sorted = [...REPLAY_SERIES.prices].sort((a, b) => a.timestamp - b.timestamp);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (ts >= sorted[i].timestamp && ts <= sorted[i + 1].timestamp) {
      const t0 = sorted[i].timestamp;
      const t1 = sorted[i + 1].timestamp;
      const p0 = sorted[i].price;
      const p1 = sorted[i + 1].price;
      return p0 + ((p1 - p0) * (ts - t0)) / (t1 - t0);
    }
  }
  return sorted[sorted.length - 1].price;
}

export function createLagProvider(
  connection: Connection,
  wallet: Wallet,
  lagSlots: number = 150 // ~45s at 300ms/slot
): AnchorProvider {
  const provider = new AnchorProvider(
    connection,
    wallet,
    { commitment: "confirmed" }
  );

  // Wrap to inject oracle lag (for sim only)
  const originalRpcRequest = (provider as any).connection._rpcRequest;
  (provider as any).connection._rpcRequest = async (method: string, args: any[]) => {
    if (method === "getAccountInfo" && args[0] === PYTH_JITO_SOL_PRICE_FEED.toString()) {
      // simulate lag by using older price (handled in oracle-utils caller)
      await new Promise((r) => setTimeout(r, 100));
    }
    return originalRpcRequest ? originalRpcRequest.call((provider as any).connection, method, args) : null;
  };

  return provider;
}

export async function loadVaultProgram(provider: AnchorProvider): Promise<Program<Vault>> {
  const idl = (await anchor.Program.fetchIdl(
    new PublicKey("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"), // placeholder program ID
    provider
  )) as Idl;

  return new Program(idl as any, provider) as Program<Vault>;
}
