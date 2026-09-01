use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

declare_id!("Vau1tX2z9pX7kL5mN8oPqR9sT2uV4wX6yZ8aBcDeFgH");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = *ctx.accounts.owner.key;
        vault.buffer = 0;
        vault.is_paused = false;
        vault.last_update_slot = Clock::get()?.slot;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        // In sim, we assume jitoSOL deposit is handled via CPI or external; here we just record
        let vault = &mut ctx.accounts.vault;
        vault.buffer = vault.buffer.saturating_add(amount);
        vault.last_update_slot = Clock::get()?.slot;
        Ok(())
    }

    pub fn drawdown(ctx: Context<Drawdown>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);
        // Simple drawdown logic for sim - in real would check circuit breaker
        vault.buffer = 0;
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        require!(vault.buffer >= amount, ErrorCode::InsufficientFunds);
        vault.buffer = vault.buffer.saturating_sub(amount);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = owner, space = 8 + 32 + 8 + 1 + 8, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    // token accounts omitted for pure sim harness
}

#[derive(Accounts)]
pub struct Drawdown<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
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
}

#[account]
#[derive(Default, Pod, Zeroable, Copy, Clone)]
#[repr(C)]
pub struct Vault {
    pub owner: Pubkey,
    pub buffer: u64,
    pub is_paused: bool,
    pub last_update_slot: u64,
    // explicit padding removed; Anchor + Pod handles layout
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Insufficient funds")]
    InsufficientFunds,
}
