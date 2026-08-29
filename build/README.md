# MandateVault JitoSOL Depeg Protection Simulator

Pure on-chain Anchor test-validator simulation harness that replays historical JitoSOL depeg price series with configurable oracle lag to test a circuit-breaker vault.

## Components

- **Vault Program** (`programs/vault`): Anchor Rust program with:
  - jitoSOL deposits into a protected buffer PDA
  - Owner-controlled pause and emergency withdraw
  - Drawdown circuit-breaker instruction (triggers on >15% drawdown vs 15s TWAP)
- **Lag Injector** (`sim/lag-injector.ts`): Replays last three real Jito depeg price series against local test validator with slot-exact 45s oracle lag
- **TWAP False-Positive Checker** (`sim/twap-checker.ts`): Validates 15-second TWAP logic against replayed series to quantify breaker trips vs false positives
- **7-Day Tick Runner** (`sim/tick-runner.ts`): Drives full simulation over 7-day historical window, logs breaker trips and statistics

## Prerequisites

- Rust (stable)
- Node.js 18+ and yarn
- Solana CLI >= 1.18
- Anchor CLI >= 0.29

## Setup

