import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { LagInjector } from './lag-injector';
import { getHistoricalJitoPrices, createTestOracle, PriceData } from './oracle-utils';
import { checkTWAPFalsePositive } from './twap-checker';

interface TWAPConfig {
  windowSeconds: number;
  thresholdBps: number;
  minObservations: number;
}

const DEFAULT_TWAP_CONFIG: TWAPConfig = {
  windowSeconds: 15,
  thresholdBps: 500,
  minObservations: 3,
};

async function runSimulation(days: number = 7): Promise<void> {
  console.log(`Starting 7-day JitoSOL depeg simulation with ${days} days of replay...`);

  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  const oracleKeypair = Keypair.generate();
  const oraclePubkey = oracleKeypair.publicKey;

  const testOracle = await createTestOracle(connection, oracleKeypair);

  const injector = new LagInjector(testOracle, 45);
  const historicalPrices: PriceData[] = await getHistoricalJitoPrices();

  console.log(`Loaded ${historicalPrices.length} historical price points.`);

  // Replay with lag injection
  const injectedPrices = await injector.injectLag(historicalPrices);
  console.log(`Injected lag: produced ${injectedPrices.length} delayed observations.`);

  let breakerTrips = 0;
  let falsePositives = 0;
  const windowSize = 60; // ~15s TWAP checks every minute of simulated time

  for (let i = windowSize; i < injectedPrices.length; i += windowSize) {
    const window = injectedPrices.slice(i - windowSize, i);
    const isFalsePositive = checkTWAPFalsePositive(window, DEFAULT_TWAP_CONFIG);

    if (isFalsePositive) {
      falsePositives++;
    }

    // Simple drawdown circuit breaker simulation (price drop > 10%)
    const startPrice = window[0].price;
    const endPrice = window[window.length - 1].price;
    if ((startPrice - endPrice) / startPrice > 0.10) {
      breakerTrips++;
      console.log(`Circuit breaker tripped at index ${i} (price drop detected)`);
    }
  }

  console.log('\n=== Simulation Results ===');
  console.log(`Total breaker trips: ${breakerTrips}`);
  console.log(`False positives from 15s TWAP: ${falsePositives}`);
  console.log(`False positive rate: ${((falsePositives / (injectedPrices.length / windowSize)) * 100).toFixed(2)}%`);
  console.log('Pure onchain Anchor vault sim completed successfully.');
}

// Allow direct execution
if (require.main === module) {
  runSimulation().catch(console.error);
}

export { runSimulation, DEFAULT_TWAP_CONFIG };
export type { TWAPConfig };
