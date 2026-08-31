use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::clock::Clock;
use bytemuck::{Pod, Zeroable};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = *ctx.accounts.owner.key;
        vault.jito_sol_mint = *ctx.accounts.jito_sol_mint.key;
        vault.protection_buffer = *ctx.accounts.protection_buffer.key;
        vault.is_paused = false;
        vault.drawdown_threshold = 500; // 5% in bps
        vault.last_twap = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, VaultError::VaultPaused);

        // In a real integration this would CPI to the JitoSOL stake pool.
        // For the sim we just record the deposit.
        msg!("Deposited {} jitoSOL", amount);
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, VaultError::Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, VaultError::Unauthorized);
        vault.is_paused = false;
        Ok(())
    }

    pub fn drawdown_circuit_breaker(ctx: Context<DrawdownCircuitBreaker>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let clock = Clock::get()?;
        let current_price = get_oracle_price(&ctx.accounts.price_oracle)?;

        let twap = compute_twap(current_price, vault.last_twap, clock.slot);
        vault.last_twap = twap;

        let drawdown = if vault.last_twap > 0 {
            ((vault.last_twap as i128 - current_price as i128) * 10000 / vault.last_twap as i128) as u64
        } else {
            0
        };

        if drawdown > vault.drawdown_threshold {
            vault.is_paused = true;
            msg!("Circuit breaker tripped! Drawdown: {} bps", drawdown);
        }
        Ok(())
    }

    pub fn withdraw_buffer(ctx: Context<WithdrawBuffer>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, VaultError::Unauthorized);
        require!(vault.is_paused, VaultError::NotPaused);
        msg!("Withdrew {} from protection buffer", amount);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = owner, space = 8 + Vault::LEN)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub jito_sol_mint: AccountInfo<'info>,
    pub protection_buffer: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Unpause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct DrawdownCircuitBreaker<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    /// CHECK: oracle account (stub for sim)
    pub price_oracle: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct WithdrawBuffer<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
    /// CHECK: buffer PDA or token account (stub)
    #[account(mut)]
    pub buffer: AccountInfo<'info>,
}

#[account]
#[derive(Default)]
pub struct Vault {
    pub owner: Pubkey,
    pub jito_sol_mint: Pubkey,
    pub protection_buffer: Pubkey,
    pub is_paused: bool,
    pub drawdown_threshold: u64,
    pub last_twap: u64,
}

impl Vault {
    pub const LEN: usize = 32 + 32 + 32 + 1 + 8 + 8;
}

#[error_code]
pub enum VaultError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Vault is not paused")]
    NotPaused,
    #[msg("Invalid oracle price")]
    InvalidPrice,
}

// Stub oracle price reader for the sim harness.
// In a real deployment this would read from a Switchboard or Pyth account.
fn get_oracle_price(oracle: &AccountInfo) -> Result<u64> {
    // For the pure-onchain test validator sim we return a placeholder that
    // the lag-injector will update via direct account writes.
    Ok(950_000_000) // ~0.95 SOL
}

// Very simple slot-based TWAP stub used by the circuit breaker.
fn compute_twap(current: u64, previous_twap: u64, _slot: u64) -> u64 {
    if previous_twap == 0 {
        current
    } else {
        (current + previous_twap * 3) / 4
    }
}
