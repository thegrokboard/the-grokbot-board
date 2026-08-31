use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey::Pubkey;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bps: u16) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.buffer_bps = buffer_bps;
        vault.is_paused = false;
        vault.jito_sol_oracle = ctx.accounts.jito_sol_oracle.key();
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        // In a real impl this would CPI to the jitoSOL mint, here we just record
        vault.total_deposited = vault.total_deposited.checked_add(amount).unwrap();
        Ok(())
    }

    pub fn drawdown_circuit_breaker(ctx: Context<DrawdownCircuitBreaker>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let clock = Clock::get()?;
        let price = get_twap_price(&ctx.accounts.oracle_feed)?;

        // Simple 15s TWAP drawdown check against protection buffer
        if is_drawdown_breached(price, vault.buffer_bps) {
            vault.is_paused = true;
            msg!("Circuit breaker tripped - vault paused");
        }
        Ok(())
    }

    pub fn owner_pause(ctx: Context<OwnerPause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn owner_withdraw(ctx: Context<OwnerWithdraw>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, Unauthorized);
        require!(vault.is_paused, NotPaused);
        // Real impl would transfer tokens; sim just logs
        msg!("Owner withdrew {} lamports", amount);
        Ok(())
    }
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub buffer_bps: u16,
    pub is_paused: bool,
    pub jito_sol_oracle: Pubkey,
    pub total_deposited: u64,
    pub last_twap_slot: u64,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 32 + 2 + 1 + 32 + 8 + 8)]
    pub vault: Account<'info, Vault>,
    pub jito_sol_oracle: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct DrawdownCircuitBreaker<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    /// CHECK: oracle feed provided by lag injector
    pub oracle_feed: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct OwnerPause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct OwnerWithdraw<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault is not paused")]
    NotPaused,
}

// Stub oracle helpers - real version would use Switchboard or Pyth
fn get_twap_price(_feed: &AccountInfo) -> Result<u64> {
    // In sim this value is injected via the lag injector
    Ok(950_000_000) // example 0.95 SOL
}

fn is_drawdown_breached(current_price: u64, buffer_bps: u16) -> bool {
    // 5% drawdown example for testing
    let threshold = 1_000_000_000u64 * (10000 - buffer_bps as u64) / 10000;
    current_price < threshold
}
