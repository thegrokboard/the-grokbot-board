import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { checkTWAPFalsePositive } from "./twap-checker";
import { getHistoricalJitoPrices, HistoricalPriceSeries, PriceData } from "./oracle-utils";
import fs from "fs";

// Configuration
const LAG_TARGET_SLOTS = 90; // ~45s at 500ms/slot
const TWAP_WINDOW_SLOTS = 30; // 15s TWAP
const TICK_INTERVAL_MS = 15000; // 15s ticks
const SIM_DAYS = 7;
const SLOTS_PER_DAY = 24 * 60 * 60 * 2; // ~2 slots per second
const TOTAL_SLOTS = SIM_DAYS * SLOTS_PER_DAY;

interface SimConfig {
  lagSlots: number;
  twapSlots: number;
  startSlot: number;
  outputPath: string;
}

class TickRunner {
  private connection: Connection;
  private injector: LagInjector;
  private config: SimConfig;
  private logs: string[] = [];
  private breakerTrips = 0;
  private falsePositives = 0;
  private currentSlot = 0;

  constructor(config: SimConfig) {
    this.config = config;
    this.connection = new Connection("http://127.0.0.1:8899", "confirmed");
    this.injector = new LagInjector(this.connection, config.lagSlots);
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}][slot=${this.currentSlot}] ${message}`;
    this.logs.push(entry);
    console.log(entry);
  }

  private async advanceSlot(ticks: number = 1): Promise<void> {
    this.currentSlot += ticks;
    // In real sim this would drive the test validator clock, here we just track
    await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS / ticks));
  }

  public async run(): Promise<void> {
    this.log("Starting 7-day JitoSOL depeg simulation with lag injector and TWAP checker");

    const historicalSeries: HistoricalPriceSeries = getHistoricalJitoPrices();
    this.log(`Loaded historical price series with ${historicalSeries.length} entries`);

    // Replay the last three depeg series with configurable oracle lag
    const laggedSeries: PriceData[][] = this.injector.replayLaggedSeries(historicalSeries, this.config.lagSlots);
    this.log(`Injected lag of ${this.config.lagSlots} slots. Replayed series length: ${laggedSeries.length}`);

    let tripCount = 0;
    let falsePositiveCount = 0;

    // Simulate over total slots with 15s ticks
    for (let tick = 0; tick < TOTAL_SLOTS; tick += 30) { // 15s = ~30 slots
      this.currentSlot = this.config.startSlot + tick;

      // Get recent prices up to current slot (simulating oracle feed)
      const recentPrices: PriceData[] = this.injector.getRecentPrices(this.currentSlot, 120); // last ~60s window

      if (recentPrices.length < 10) {
        await this.advanceSlot(30);
        continue;
      }

      // Run 15s TWAP false-positive checker
      const isFalsePositive = checkTWAPFalsePositive(recentPrices, this.config.twapSlots);

      // Simulate drawdown circuit-breaker logic (simple threshold for demo)
      const latestPrice = recentPrices[recentPrices.length - 1].price;
      const twap = this.computeTWAP(recentPrices, this.config.twapSlots);
      const drawdown = (twap - latestPrice) / twap;

      let breakerTriggered = false;
      if (drawdown > 0.15 && !isFalsePositive) { // 15% drawdown
        breakerTriggered = true;
        tripCount++;
        this.log(`CIRCUIT_BREAKER_TRIP: drawdown=${(drawdown * 100).toFixed(2)}%, TWAP=${twap.toFixed(4)}, price=${latestPrice.toFixed(4)}`);
      } else if (drawdown > 0.15 && isFalsePositive) {
        falsePositiveCount++;
        this.log(`FALSE_POSITIVE: drawdown=${(drawdown * 100).toFixed(2)}% flagged as TWAP-stable`);
      }

      await this.advanceSlot(30);
    }

    this.breakerTrips = tripCount;
    this.falsePositives = falsePositiveCount;

    this.log(`Simulation complete. Breaker trips: ${this.breakerTrips}, False positives: ${this.falsePositives}`);

    // Write logs and summary
    this.writeResults();
  }

  private computeTWAP(prices: PriceData[], window: number): number {
    if (prices.length === 0) return 0;
    const recent = prices.slice(-window);
    const sum = recent.reduce((acc, p) => acc + p.price, 0);
    return sum / recent.length;
  }

  private writeResults(): void {
    const summary = {
      simDays: SIM_DAYS,
      lagSlots: this.config.lagSlots,
      twapSlots: this.config.twapSlots,
      breakerTrips: this.breakerTrips,
      falsePositives: this.falsePositives,
      totalTicks: Math.floor(TOTAL_SLOTS / 30),
      logLines: this.logs.length,
    };

    fs.writeFileSync(this.config.outputPath, JSON.stringify(summary, null, 2));
    fs.writeFileSync("sim-logs.txt", this.logs.join("\n"));

    this.log(`Results written to ${this.config.outputPath}`);
  }
}

// Main entrypoint
async function main() {
  const config: SimConfig = {
    lagSlots: LAG_TARGET_SLOTS,
    twapSlots: TWAP_WINDOW_SLOTS,
    startSlot: 123456789,
    outputPath: "sim-results.json",
  };

  const runner = new TickRunner(config);
  await runner.run();
}

main().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
