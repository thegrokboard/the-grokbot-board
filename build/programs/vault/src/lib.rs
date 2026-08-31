use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

declare_id!("Vault1111111111111111111111111111111111111111");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = *ctx.accounts.owner.key;
        vault.protection_buffer = 0;
        vault.is_paused = false;
        vault.last_twap = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        // Placeholder for jitoSOL deposit handling
        let vault = &mut ctx.accounts.vault;
        // In real impl would CPI to jitoSOL, here we just record
        vault.protection_buffer = vault.protection_buffer.saturating_add(amount);
        Ok(())
    }

    pub fn drawdown(ctx: Context<Drawdown>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);
        // Circuit breaker logic would go here based on TWAP/oracle
        // For sim we just log the call
        msg!("Drawdown circuit breaker triggered");
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = true;
        msg!("Vault paused by owner");
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        require!(vault.protection_buffer >= amount, ErrorCode::InsufficientBuffer);
        vault.protection_buffer = vault.protection_buffer.saturating_sub(amount);
        msg!("Withdrew {} from protection buffer", amount);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = owner, space = 8 + 8 + 8 + 1 + 8)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    // In full impl would include jitoSOL token accounts
}

#[derive(Accounts)]
pub struct Drawdown<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    // Would include oracle account in real version
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
#[derive(Default)]
pub struct Vault {
    pub owner: Pubkey,
    pub protection_buffer: u64,
    pub is_paused: bool,
    pub last_twap: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct PriceAccount {
    pub price: i64,
    pub confidence: u64,
    pub expo: i32,
    pub publish_time: i64,
}

impl anchor_lang::Owner for PriceAccount {
    fn owner() -> Pubkey {
        ID
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Insufficient protection buffer")]
    InsufficientBuffer,
}
