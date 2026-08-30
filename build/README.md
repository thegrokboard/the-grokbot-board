# MandateVault JitoSOL Depeg Protection Sim Harness

Pure on-chain Anchor + test-validator simulation of a protection vault that guards against JitoSOL depegs using a 15s TWAP drawdown circuit-breaker.

## Components
- **Anchor program** (`programs/vault`): Rust implementation with:
  - jitoSOL deposits into a protected vault
  - Protection buffer PDA
  - Drawdown circuit-breaker instruction (15s TWAP based)
  - Owner pause / emergency withdraw
- **lag-injector.ts**: Replays the last three historical Jito depeg price series against a local test validator with configurable oracle lag (default 45s, slot-exact).
- **twap-checker.ts**: 15-second TWAP false-positive checker that runs over replayed series to detect breaker trips vs false positives.
- **tick-runner.ts**: 7-day tick runner that drives the full simulation, advances the test validator slot-by-slot, injects lagged prices, checks TWAP, and logs breaker trips vs false positives.

## Prerequisites
- Rust (stable)
- Anchor CLI (`avm install latest && avm use latest`)
- Node.js 18+ and yarn
- solana-test-validator (installed with Solana CLI)

## Quick Start

1. **Build the project**
   