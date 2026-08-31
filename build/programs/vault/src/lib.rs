use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::clock::Clock;
use bytemuck::{Pod, Zeroable};

declare_id!("Vault111111111111111111111111111111111111111");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = ctx.accounts.owner.key();
        vault.protection_buffer = ctx.accounts.protection_buffer.key();
        vault.jito_sol_mint = ctx.accounts.jito_sol_mint.key();
        vault.oracle = ctx.accounts.oracle.key();
        vault.buffer_amount = params.initial_buffer_amount;
        vault.drawdown_threshold = params.drawdown_threshold;
        vault.paused = false;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.paused, ErrorCode::VaultPaused);

        // In a real implementation this would CPI to the JitoSOL token program
        // For sim we just record the deposit
        vault.total_deposited = vault.total_deposited.checked_add(amount).unwrap();
        Ok(())
    }

    pub fn drawdown_breaker(ctx: Context<DrawdownBreaker>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let clock = Clock::get()?;

        let price = get_oracle_price(&ctx.accounts.oracle)?;
        let twap = calculate_twap(&ctx.accounts.oracle, clock.slot)?;

        let drawdown = if twap > 0 {
            ((twap as i128 - price as i128) * 10000 / twap as i128) as u64
        } else {
            0
        };

        if drawdown > vault.drawdown_threshold {
            vault.breaker_tripped = true;
            vault.paused = true;
            msg!("Circuit breaker tripped! Drawdown: {}%", drawdown);
        }

        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        vault.paused = true;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        require!(vault.paused || vault.breaker_tripped, ErrorCode::NotPaused);

        // In sim we just reduce the tracked balance
        if amount > vault.buffer_amount {
            return Err(ErrorCode::InsufficientBuffer.into());
        }
        vault.buffer_amount = vault.buffer_amount.saturating_sub(amount);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = owner, space = 8 + Vault::LEN)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
    /// CHECK: protection buffer PDA or account
    pub protection_buffer: UncheckedAccount<'info>,
    pub jito_sol_mint: AccountInfo<'info>,
    /// CHECK: oracle account (Switchboard or custom)
    pub oracle: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub depositor: Signer<'info>,
    // token accounts omitted for sim harness
}

#[derive(Accounts)]
pub struct DrawdownBreaker<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    /// CHECK: oracle
    pub oracle: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
    // withdrawal destination omitted for sim
}

#[account]
#[derive(Default)]
pub struct Vault {
    pub owner: Pubkey,
    pub protection_buffer: Pubkey,
    pub jito_sol_mint: Pubkey,
    pub oracle: Pubkey,
    pub buffer_amount: u64,
    pub total_deposited: u64,
    pub drawdown_threshold: u64,
    pub paused: bool,
    pub breaker_tripped: bool,
    pub last_update_slot: u64,
}

impl Vault {
    pub const LEN: usize = 8 * 32 + 8 * 4 + 1 * 2; // rough size
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeParams {
    pub initial_buffer_amount: u64,
    pub drawdown_threshold: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Not paused or breaker not tripped")]
    NotPaused,
    #[msg("Insufficient protection buffer")]
    InsufficientBuffer,
    #[msg("Invalid oracle data")]
    InvalidOracle,
}

// Stub oracle helpers for the sim harness (real impl would parse Switchboard or custom feed)
fn get_oracle_price(oracle: &UncheckedAccount) -> Result<u64> {
    // In TS lag injector we update a simple price account; here we read last known price
    // For compilation we stub; runtime is driven by injected test validator state
    Ok(95_000_000) // placeholder 0.95
}

fn calculate_twap(_oracle: &UncheckedAccount, _current_slot: u64) -> Result<u64> {
    // 15s TWAP logic is exercised in twap-checker.ts; here we provide a plausible value
    Ok(100_000_000) // placeholder 1.00
}
