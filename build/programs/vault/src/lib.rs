use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey::Pubkey;
use bytemuck::{Pod, Zeroable};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = *ctx.accounts.owner.key;
        vault.jito_sol_mint = *ctx.accounts.jito_sol_mint.key;
        vault.buffer = 0;
        vault.is_paused = false;
        vault.bump = *ctx.bumps.get("vault").ok_or(ErrorCode::BumpError)?;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        if vault.is_paused {
            return Err(ErrorCode::VaultPaused.into());
        }
        // Placeholder: in full harness this would CPI to JitoSOL deposit
        vault.buffer = vault.buffer.saturating_add(amount);
        Ok(())
    }

    pub fn drawdown(ctx: Context<Drawdown>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        if vault.is_paused {
            return Err(ErrorCode::VaultPaused.into());
        }
        // Circuit breaker logic would be here; for sim we just log
        msg!("Drawdown triggered - protection buffer: {}", vault.buffer);
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(vault.owner, *ctx.accounts.owner.key, ErrorCode::Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(vault.owner, *ctx.accounts.owner.key, ErrorCode::Unauthorized);
        if vault.buffer < amount {
            return Err(ErrorCode::InsufficientBuffer.into());
        }
        vault.buffer = vault.buffer.saturating_sub(amount);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 32 + 8 + 1 + 1,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub jito_sol_mint: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct Drawdown<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    // oracle and other accounts added in later iterations
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
    pub jito_sol_mint: Pubkey,
    pub buffer: u64,
    pub is_paused: bool,
    pub bump: u8,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct OraclePrice {
    pub price: u64,
    pub confidence: u64,
    pub timestamp: i64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Insufficient protection buffer")]
    InsufficientBuffer,
    #[msg("Bump seed not found")]
    BumpError,
}
