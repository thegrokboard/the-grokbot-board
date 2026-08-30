# MandateVault JitoSOL Depeg Protection Sim Harness

Pure on-chain Anchor test-validator simulation that replays real historical Jito depeg price series with configurable oracle lag to test a drawdown circuit-breaker.

## Components

- **Anchor Vault Program** (`programs/vault`): Rust on-chain logic with:
  - jitoSOL deposits into protected vault
  - Protection buffer PDA
  - Drawdown circuit-breaker instruction (15s TWAP trigger)
  - Owner pause + emergency withdraw

- **Lag Injector** (`sim/lag-injector.ts`): Replays the last three real Jito depeg price series against a local test validator. Injects oracle updates with a configurable lag (default 45s, slot-exact).

- **TWAP False-Positive Checker** (`sim/twap-checker.ts`): Runs 15-second TWAP logic over the replayed series to detect breaker trips vs false positives.

- **7-Day Tick Runner** (`sim/tick-runner.ts`): Drives the full simulation by advancing the test validator slot-by-slot, feeding lagged prices, and logging breaker behavior over a simulated 7-day period.

## Prerequisites

- Rust (stable)
- Anchor CLI v0.29.0+
- Node.js 18+ and Yarn
- solana-test-validator (installed with Solana CLI)

## Exact Run Instructions

1. **Build the project**
   