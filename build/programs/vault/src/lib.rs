use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.paused = false;
        vault.buffer_bump = buffer_bump;
        vault.last_twap = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.paused, VaultError::VaultPaused);

        // In sim we assume jitoSOL transfer happens off-instruction via ATA
        // Real integration would CPI to jito-stake-pool or token program here
        Ok(())
    }

    pub fn drawdown(ctx: Context<Drawdown>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.paused, VaultError::VaultPaused);

        // Protection buffer drawdown logic (simplified for harness)
        // In production this would transfer out excess to owner or insurance
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.signer.key() == vault.owner, VaultError::Unauthorized);
        vault.paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.signer.key() == vault.owner, VaultError::Unauthorized);
        vault.paused = false;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.signer.key() == vault.owner, VaultError::Unauthorized);
        require!(vault.paused, VaultError::NotPaused);
        // Real withdraw would transfer jitoSOL or native SOL; omitted in sim
        Ok(())
    }

    pub fn update_twap(ctx: Context<UpdateTwap>, new_twap: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.last_twap = new_twap;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(buffer_bump: u8)]
pub struct Initialize<'info> {
    #[account(init, payer = signer, space = 8 + 8 + 1 + 1 + 8, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    #[account(seeds = [b"buffer", vault.key().as_ref()], bump = buffer_bump)]
    pub protection_buffer: AccountInfo<'info>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub protection_buffer: Account<'info, ProtectionBuffer>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct Drawdown<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub protection_buffer: Account<'info, ProtectionBuffer>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct Unpause<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub protection_buffer: Account<'info, ProtectionBuffer>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateTwap<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub signer: Signer<'info>,
}

#[account]
#[derive(Default)]
pub struct VaultState {
    pub owner: Pubkey,
    pub paused: bool,
    pub buffer_bump: u8,
    pub last_twap: u64,
}

#[account(zero_copy)]
#[derive(Default, Pod, Zeroable, Copy, Clone)]
#[repr(C)]
pub struct ProtectionBuffer {
    pub total_deposits: u64,
    pub current_buffer: u64,
    pub last_update_slot: u64,
}

// Custom error codes
#[error_code]
pub enum VaultError {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Must be paused to withdraw")]
    NotPaused,
    #[msg("Drawdown circuit breaker tripped")]
    BreakerTripped,
}
