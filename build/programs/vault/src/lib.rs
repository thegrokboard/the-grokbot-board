use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bump: u8) -> Result<()> {
        let buffer = &mut ctx.accounts.protection_buffer;
        buffer.owner = owner;
        buffer.is_paused = false;
        buffer.buffer_bump = buffer_bump;
        buffer.last_twap = 0;
        buffer.drawdown_threshold = 500; // 5% in basis points
        buffer.last_update_slot = Clock::get()?.slot;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        // In sim we just log; real impl would CPI to jitoSOL stake pool
        let buffer = &mut ctx.accounts.protection_buffer;
        msg!("Deposit of {} received", amount);
        Ok(())
    }

    pub fn update_twap(ctx: Context<UpdateTwap>, new_twap: u64) -> Result<()> {
        let buffer = &mut ctx.accounts.protection_buffer;
        let clock = Clock::get()?;
        
        buffer.last_twap = new_twap;
        buffer.last_update_slot = clock.slot;
        
        // Check for drawdown
        if new_twap == 0 {
            return Ok(());
        }
        
        // Simple 5% drawdown circuit breaker for sim (real would compare vs oracle)
        if buffer.last_twap > 0 && new_twap < buffer.last_twap * 95 / 100 {
            buffer.is_paused = true;
            msg!("Circuit breaker tripped! TWAP drawdown detected.");
        }
        
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let buffer = &mut ctx.accounts.protection_buffer;
        require!(ctx.accounts.owner.key() == buffer.owner, ErrorCode::Unauthorized);
        buffer.is_paused = true;
        msg!("Vault paused by owner");
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let buffer = &mut ctx.accounts.protection_buffer;
        require!(ctx.accounts.owner.key() == buffer.owner, ErrorCode::Unauthorized);
        require!(!buffer.is_paused, ErrorCode::VaultPaused);
        msg!("Withdrew {} from buffer", amount);
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(owner: Pubkey, buffer_bump: u8)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 1 + 1 + 8 + 8 + 8,
        seeds = [b"protection_buffer", owner.as_ref()],
        bump = buffer_bump
    )]
    pub protection_buffer: Account<'info, ProtectionBuffer>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub protection_buffer: Account<'info, ProtectionBuffer>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateTwap<'info> {
    #[account(mut)]
    pub protection_buffer: Account<'info, ProtectionBuffer>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub protection_buffer: Account<'info, ProtectionBuffer>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub protection_buffer: Account<'info, ProtectionBuffer>,
    pub owner: Signer<'info>,
}

#[account]
#[derive(Default)]
pub struct ProtectionBuffer {
    pub owner: Pubkey,
    pub is_paused: bool,
    pub buffer_bump: u8,
    pub last_twap: u64,
    pub drawdown_threshold: u64,
    pub last_update_slot: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault is paused")]
    VaultPaused,
}
