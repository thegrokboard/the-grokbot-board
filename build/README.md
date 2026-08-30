# MandateVault JitoSOL Depeg Protection Simulator

Pure on-chain Anchor test-validator simulation harness that replays real historical JitoSOL depeg price series with configurable oracle lag to test a circuit-breaker vault.

## Architecture

- **Program**: `vault` (Rust/Anchor) – accepts jitoSOL deposits, maintains a protection buffer PDA, implements a drawdown circuit-breaker instruction based on 15s TWAP, plus owner pause/withdraw.
- **lag-injector.ts**: Replays the last three historical Jito depeg price series against a local test validator. Injects prices with a configurable oracle lag (default target 45s, slot-exact).
- **twap-checker.ts**: Runs a 15-second TWAP false-positive checker over the replayed series to detect breaker trips vs false positives.
- **tick-runner.ts**: 7-day tick runner that drives the entire simulation end-to-end using the injector + checker, logs breaker trips, false positives, and final stats.
- **Test Validator**: Runs with Anchor's localnet, custom clock, and pre-funded accounts.

The simulation is fully deterministic and runs entirely against a local `solana-test-validator`.

## Prerequisites

- Node.js >= 18
- Rust (cargo)
- Anchor CLI >= 0.29.0 (`avm install latest`)
- Solana CLI >= 1.18

## Quick Start

