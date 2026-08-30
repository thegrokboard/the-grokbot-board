# MandateVault JitoSOL Depeg Protection Sim Harness

Pure on-chain Anchor + test-validator simulation of the JitoSOL drawdown circuit-breaker.

This harness replays the last three historical Jito depeg events with configurable oracle lag (target 45s) and runs a 15s TWAP false-positive checker. A 7-day tick runner drives the full simulation and logs breaker trips vs false positives.

## Components

- **Anchor vault program** (`programs/vault`): Implements jitoSOL deposits into a protection buffer PDA, owner-controlled pause/withdraw, and drawdown circuit-breaker instruction using a 15s TWAP.
- **lag-injector.ts**: Replays historical Jito price series against a local test validator, injecting oracle updates with a configurable slot-exact lag.
- **twap-checker.ts**: 15-second TWAP false-positive detector that runs over the replayed series.
- **tick-runner.ts**: 7-day simulation driver that orchestrates the injector, checker, and on-chain program, logging breaker behavior.

## Prerequisites

- Rust (stable)
- Anchor CLI (`cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked`)
- Node.js 18+ and Yarn
- solana-test-validator (from Solana CLI)

## Exact Run Instructions

1. **Build the project**
   