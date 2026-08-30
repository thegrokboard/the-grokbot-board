# MandateVault JitoSOL Depeg Protection Simulator

Pure on-chain Anchor test-validator simulation harness that replays historical JitoSOL depeg events with configurable oracle lag to test a drawdown circuit-breaker.

## Components
- **Anchor Vault Program** (`programs/vault`): Rust on-chain logic with:
  - jitoSOL deposits into a protected vault
  - Protection buffer PDA holding collateral
  - Drawdown circuit-breaker instruction (15s TWAP-based)
  - Owner pause / emergency withdraw
- **Lag Injector** (`sim/lag-injector.ts`): Replays the last three real Jito depeg price series against the local test validator with a configurable oracle lag (default 45s, slot-exact).
- **TWAP False-Positive Checker** (`sim/twap-checker.ts`): Runs a 15-second TWAP over the replayed series and detects breaker trips vs false positives.
- **7-Day Tick Runner** (`sim/tick-runner.ts`): Drives the full simulation end-to-end, advancing the test validator slot-by-slot while injecting lagged prices.

## Prerequisites
- Node.js >= 18
- Rust (stable)
- Anchor CLI (`cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked`)
- Solana CLI (`sh -c "$(curl -sSfL https://release.solana.com/stable/install)"`)

## Setup

