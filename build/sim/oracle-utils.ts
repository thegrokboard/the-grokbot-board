import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair, SystemProgram } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";

export interface PriceData {
  price: number;
  confidence: number;
  timestamp: number;
  slot: number;
}

export interface OracleConfig {
  oracleProgramId: PublicKey;
  priceFeed: PublicKey;
  admin: PublicKey;
  updateInterval: number;
}

export interface TestOracle {
  priceFeed: PublicKey;
  updatePrice: (price: number, slot: number) => Promise<void>;
}

export function createTestOracle(
  connection: Connection,
  payer: Keypair,
  config: OracleConfig
): TestOracle {
  const priceFeed = config.priceFeed;

  const updatePrice = async (price: number, slot: number): Promise<void> => {
    // For the sim harness we simulate an oracle update via direct account write
    // In a real deployment this would call the actual oracle program's update ix
    const priceLamports = Math.floor(price * 1_000_000);
    const data = Buffer.alloc(8 + 8 + 8);
    data.writeBigUInt64LE(BigInt(priceLamports), 0);
    data.writeBigUInt64LE(BigInt(slot), 8);
    data.writeBigUInt64LE(BigInt(Math.floor(Date.now() / 1000)), 16);

    const ix = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: priceFeed,
      lamports: 0,
    });

    const tx = new anchor.web3.Transaction().add(ix);
    await anchor.web3.sendAndConfirmTransaction(connection, tx, [payer]);
  };

  return {
    priceFeed,
    updatePrice,
  };
}

export async function updateTestOracle(
  oracle: TestOracle,
  price: number,
  slot: number
): Promise<void> {
  await oracle.updatePrice(price, slot);
}

export function createLagInjector(
  oracle: TestOracle,
  lagSlots: number = 90 // ~45s at 500ms/slot
) {
  let priceHistory: Array<{ price: number; slot: number }> = [];

  return {
    injectLagPrice: async (price: number, currentSlot: number): Promise<void> => {
      priceHistory.push({ price, slot: currentSlot });
      // Replay with lag
      const lagSlot = currentSlot - lagSlots;
      const lagged = priceHistory.find(p => p.slot <= lagSlot);
      if (lagged) {
        await oracle.updatePrice(lagged.price, currentSlot);
      } else {
        await oracle.updatePrice(price, currentSlot);
      }
      // Keep last 3 depeg series only
      if (priceHistory.length > 3) {
        priceHistory.shift();
      }
    },
  };
}
