import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { LagInjector } from "./lag-injector";
import { TWAPChecker } from "./twap-checker";
import { getHistoricalJitoPrices, PriceData } from "./oracle-utils";
import fs from "fs";

interface SimConfig {
  lagSeconds: number;
  twapPeriodSeconds: number;
  falsePositiveThreshold: number;
  tickIntervalMs: number;
  totalTicks: number;
  logFile: string;
}

const DEFAULT_CONFIG: SimConfig = {
  lagSeconds: 45,
  twapPeriodSeconds: 15,
  falsePositiveThreshold: 0.02,
  tickIntervalMs: 15000,
  totalTicks: 40320, // 7 days at 15s ticks
  logFile: "./sim-logs/breaker-trips.log",
};

class TickRunner {
  private connection: Connection;
  private lagInjector: LagInjector;
  private twapChecker: TWAPChecker;
  private config: SimConfig;
  private logs: string[] = [];
  private currentSlot = 0;
  private priceSeries: PriceData[] = [];

  constructor(
    connection: Connection,
    config: Partial<SimConfig> = {}
  ) {
    this.connection = connection;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.lagInjector = new LagInjector(this.config.lagSeconds);
    this.twapChecker = new TWAPChecker(
      this.config.twapPeriodSeconds,
      this.config.falsePositiveThreshold
    );
  }

  async init(): Promise<void> {
    console.log("Initializing 7-day JitoSOL depeg simulation...");
    this.priceSeries = await getHistoricalJitoPrices();
    if (this.priceSeries.length === 0) {
      throw new Error("No historical price data loaded");
    }
    console.log(`Loaded ${this.priceSeries.length} historical price points`);
    
    // Ensure log directory
    const logDir = this.config.logFile.substring(0, this.config.logFile.lastIndexOf("/"));
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  async run(): Promise<void> {
    await this.init();
    
    console.log(`Starting simulation with ${this.config.totalTicks} ticks at ${this.config.tickIntervalMs}ms intervals...`);
    console.log(`Lag: ${this.config.lagSeconds}s | TWAP: ${this.config.twapPeriodSeconds}s`);
    
    const startTime = Date.now();
    
    for (let tick = 0; tick < this.config.totalTicks; tick++) {
      this.currentSlot = tick * 2; // approximate 0.4s per slot, 2 slots per 15s tick
      
      // Inject lagged prices
      const injectedPrices = this.lagInjector.replayWithLag(this.priceSeries, this.currentSlot);
      
      if (injectedPrices.length > 0) {
        const latestPrice = injectedPrices[injectedPrices.length - 1];
        
        // Check for false-positive TWAP breach
        const isFalsePositive = this.twapChecker.check(latestPrice, injectedPrices);
        
        if (isFalsePositive) {
          const logEntry = `TICK ${tick} | SLOT ${this.currentSlot} | PRICE ${latestPrice.price.toFixed(4)} | FALSE_POSITIVE_BREACH`;
          this.logs.push(logEntry);
          console.log(logEntry);
        } else if (tick % 1000 === 0) {
          console.log(`TICK ${tick} | SLOT ${this.currentSlot} | PRICE ${latestPrice.price.toFixed(4)} | stable`);
        }
      }
      
      // Simulate tick delay
      if (tick < this.config.totalTicks - 1) {
        await new Promise(resolve => setTimeout(resolve, this.config.tickIntervalMs));
      }
    }
    
    this.finalize();
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Simulation completed in ${duration}s. Logged ${this.logs.length} breaker trips.`);
  }

  private finalize(): void {
    const header = `JitoSOL Depeg Simulation Log\n` +
                  `Lag: ${this.config.lagSeconds}s | TWAP: ${this.config.twapPeriodSeconds}s\n` +
                  `Total ticks: ${this.config.totalTicks} | False positive threshold: ${this.config.falsePositiveThreshold}\n` +
                  `Generated: ${new Date().toISOString()}\n\n`;
    
    fs.writeFileSync(this.config.logFile, header + this.logs.join("\n"));
  }
}

// CLI entrypoint
async function main() {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  
  // Optional config overrides via env
  const config: Partial<SimConfig> = {};
  if (process.env.LAG_SECONDS) config.lagSeconds = parseInt(process.env.LAG_SECONDS);
  if (process.env.TWAP_SECONDS) config.twapPeriodSeconds = parseInt(process.env.TWAP_SECONDS);
  
  const runner = new TickRunner(connection, config);
  await runner.run();
}

if (require.main === module) {
  main().catch(console.error);
}

export { TickRunner, DEFAULT_CONFIG };
