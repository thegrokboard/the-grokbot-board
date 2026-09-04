import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { PythSolanaReceiver, getPythProgramKeyForCluster } from "@pythnetwork/pyth-solana-receiver";

export interface PriceData {
  price: number;
  confidence: number;
  timestamp: number;
  slot: number;
}

export class OracleUtils {
  private connection: Connection;
  private programId: PublicKey;
  private priceAccount: PublicKey;
  private receiver: PythSolanaReceiver;

  constructor(connection: Connection, priceAccount: PublicKey) {
    this.connection = connection;
    this.priceAccount = priceAccount;
    this.programId = getPythProgramKeyForCluster("localnet");
    this.receiver = new PythSolanaReceiver({
      connection,
      wallet: new anchor.Wallet(Keypair.generate()), // dummy for local sim
    });
  }

  async updateOracle(price: number, confidence: number = 0.01, timestamp?: number): Promise<void> {
    const slot = await this.connection.getSlot();
    const pythPrice = {
      price: Math.floor(price * 1_000_000),
      conf: Math.floor(confidence * 1_000_000),
      expo: -6,
      publishTime: timestamp || Math.floor(Date.now() / 1000),
    };

    // In a real sim we would post a message; here we just log for replay
    console.log(`[OracleUtils] updateOracle slot=${slot} price=${price} conf=${confidence}`);
    // No-op on local test validator for lag-injector replay; real harness uses mock feed
  }

  async getLatestPrice(): Promise<PriceData> {
    // Mock latest for sim harness
    return {
      price: 0.95,
      confidence: 0.02,
      timestamp: Math.floor(Date.now() / 1000),
      slot: await this.connection.getSlot(),
    };
  }
}

export async function getHistoricalJitoPrices(): Promise<PriceData[]> {
  // Replay of last three known JitoSOL depeg series (sim data)
  return [
    { price: 0.98, confidence: 0.015, timestamp: 1710000000, slot: 100 },
    { price: 0.92, confidence: 0.025, timestamp: 1710000045, slot: 145 },
    { price: 0.87, confidence: 0.018, timestamp: 1710000090, slot: 190 },
    { price: 0.75, confidence: 0.030, timestamp: 1710000135, slot: 235 },
    { price: 0.68, confidence: 0.022, timestamp: 1710000180, slot: 280 },
  ];
}

export default OracleUtils;
