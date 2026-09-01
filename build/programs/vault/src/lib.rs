use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, protection_buffer_bps: u16) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.protection_buffer_bps = protection_buffer_bps;
        vault.is_paused = 0;
        vault.last_twap = 0;
        vault.drawdown_threshold = 500; // 5%
        vault.bump = *ctx.bumps.get("vault").unwrap();
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        // JitoSOL deposit stub - in real sim this would CPI to Jito or use ATA
        let vault = &mut ctx.accounts.vault;
        // placeholder logic
        Ok(())
    }

    pub fn drawdown_breaker(ctx: Context<DrawdownBreaker>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let clock = Clock::get()?;
        let current_price = 950_000_000u64; // simulated depeg feed
        let twap = vault.last_twap;

        if current_price * 10000 < twap * (10000 - vault.drawdown_threshold as u64) {
            vault.is_paused = 1;
        }
        vault.last_twap = current_price;
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.signer.key() == vault.owner, Unauthorized);
        vault.is_paused = 1;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.signer.key() == vault.owner, Unauthorized);
        require!(vault.is_paused == 0, VaultPaused);
        // placeholder withdraw
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = signer, space = 8 + 8 + 32 + 2 + 1 + 8 + 2 + 1, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct DrawdownBreaker<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub oracle: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub signer: Signer<'info>,
}

#[account]
#[derive(Default, Zeroable, Pod)]
#[repr(C)]
pub struct Vault {
    pub owner: Pubkey,
    pub last_twap: u64,
    pub protection_buffer_bps: u16,
    pub is_paused: u8,
    pub drawdown_threshold: u16,
    pub bump: u8,
    pub _padding: [u8; 6],
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault is paused")]
    VaultPaused,
}
