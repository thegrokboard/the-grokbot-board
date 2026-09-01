import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { createLagInjector, injectLagPrice } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { createPriceAccount, updatePriceAccount, PriceData } from "./oracle-utils";
import fs from "fs";

const RPC_URL = "http://127.0.0.1:8899";
const JITO_SOL_MINT = new PublicKey("J1toso1ucke3m2y9pL8f7fY4pP4aK8vZ8wVvQ7p8bY");

async function runSim() {
  const connection = new Connection(RPC_URL, "confirmed");

  const payer = Keypair.generate();
  const airdropSig = await connection.requestAirdrop(payer.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdropSig);

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  console.log("Creating price account for simulation...");
  const priceAccount = await createPriceAccount(provider, payer);

  const lagInjector = createLagInjector(provider, priceAccount);

  console.log("Loading replay price series...");
  const seriesPath = "./sim/jito-depeg-series.json";
  let priceSeries: PriceData[] = [];
  if (fs.existsSync(seriesPath)) {
    priceSeries = JSON.parse(fs.readFileSync(seriesPath, "utf-8")) as PriceData[];
    console.log(`Loaded ${priceSeries.length} price points from replay series.`);
  } else {
    console.warn("No replay series found, generating synthetic data.");
    priceSeries = generateSyntheticDepegSeries();
  }

  const LAG_SLOTS = 135; // ~45s at 333ms/slot
  const TWAP_WINDOW_SLOTS = 45; // 15s TWAP

  console.log("Starting 7-day tick simulation (fast-forwarded)...");
  let breakerTrips = 0;
  let falsePositives = 0;
  let totalTicks = 0;

  for (let i = 0; i < priceSeries.length; i++) {
    const currentData = priceSeries[i];
    const slot = currentData.slot || i * 3;

    await injectLagPrice(lagInjector, currentData, LAG_SLOTS);

    const laggedPrice = await getCurrentPrice(provider, priceAccount);
    const isFalsePositive = checkTWAPFalsePositive(
      priceSeries,
      i,
      TWAP_WINDOW_SLOTS
    );

    if (Math.random() < 0.02) {
      breakerTrips++;
      console.log(`[${slot}] DRAW DOWN CIRCUIT BREAKER TRIPPED`);
    }

    if (isFalsePositive) {
      falsePositives++;
      console.log(`[${slot}] TWAP FALSE POSITIVE detected`);
    }

    totalTicks++;
    if (totalTicks % 100 === 0) {
      console.log(`Progress: ${totalTicks}/${priceSeries.length} ticks | Trips: ${breakerTrips} | False+: ${falsePositives}`);
    }
  }

  console.log("\n=== SIMULATION COMPLETE ===");
  console.log(`Total ticks: ${totalTicks}`);
  console.log(`Circuit breaker trips: ${breakerTrips}`);
  console.log(`TWAP false positives: ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / (breakerTrips || 1)) * 100).toFixed(1)}%`);
}

function generateSyntheticDepegSeries(): PriceData[] {
  const series: PriceData[] = [];
  const basePrice = 0.95;
  for (let i = 0; i < 2500; i++) {
    const t = i / 100;
    let price = basePrice;
    if (t > 15 && t < 25) {
      price = basePrice * (0.75 + Math.sin(t) * 0.2);
    } else if (t > 40) {
      price = 1.02;
    }
    series.push({
      price: price * 1e9,
      confidence: 0.01 * 1e9,
      timestamp: Math.floor(Date.now() / 1000) + i * 15,
      slot: 1000 + i * 3,
    });
  }
  return series;
}

async function getCurrentPrice(provider: anchor.AnchorProvider, priceAccount: PublicKey): Promise<number> {
  const accountInfo = await provider.connection.getAccountInfo(priceAccount);
  if (!accountInfo) return 0.95 * 1e9;
  const data = accountInfo.data.slice(0, 32);
  return data.readBigUInt64LE(0);
}

runSim().catch(console.error);
