use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::{self, Sysvar};
use bytemuck::{Pod, Zeroable};

declare_id!("Vault1111111111111111111111111111111111111111");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bps: u16) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.buffer_bps = buffer_bps;
        vault.paused = false;
        vault.last_twap = 0;
        vault.last_update_slot = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.paused, ErrorCode::VaultPaused);

        // In sim we just record; real would CPI to jito stake pool
        let clock = Clock::get()?;
        vault.last_update_slot = clock.slot;

        Ok(())
    }

    pub fn update_price(ctx: Context<UpdatePrice>) -> Result<()> {
        let price_account = &ctx.accounts.price_account;
        let vault = &mut ctx.accounts.vault;
        let clock = Clock::get()?;

        let price = price_account.get_price();
        let slot = price_account.get_slot();

        // Simple TWAP simulation for 15s window (assume ~0.4s/slot, ~38 slots)
        let window_slots = 40u64;
        if slot > window_slots && vault.last_update_slot > 0 {
            let twap = price; // placeholder: real impl would use oracle history or buffer
            vault.last_twap = twap;
        } else {
            vault.last_twap = price;
        }
        vault.last_update_slot = slot;

        Ok(())
    }

    pub fn check_drawdown(ctx: Context<CheckDrawdown>) -> Result<()> {
        let vault = &ctx.accounts.vault;
        let price_account = &ctx.accounts.price_account;
        require!(!vault.paused, ErrorCode::VaultPaused);

        let current_price = price_account.get_price();
        let twap = vault.last_twap;

        if twap == 0 {
            return Ok(());
        }

        let drawdown_bps = if current_price < twap {
            ((twap - current_price) * 10000 / twap) as u16
        } else {
            0
        };

        let threshold = vault.buffer_bps;
        if drawdown_bps > threshold {
            // Trigger circuit breaker: pause vault
            let vault_mut = &mut ctx.accounts.vault;
            vault_mut.paused = true;
            msg!("Circuit breaker tripped! Drawdown {} bps > buffer {} bps", drawdown_bps, threshold);
        }

        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, ErrorCode::Unauthorized);
        vault.paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, ErrorCode::Unauthorized);
        vault.paused = false;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, ErrorCode::Unauthorized);
        // Real impl would transfer from buffer/vault; sim just logs
        msg!("Owner withdrew {} lamports", amount);
        Ok(())
    }
}

#[account]
#[derive(Default)]
pub struct Vault {
    pub owner: Pubkey,
    pub buffer_bps: u16,       // e.g. 500 = 5%
    pub paused: bool,
    pub last_twap: u64,        // scaled price
    pub last_update_slot: u64,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = signer, space = 8 + 32 + 2 + 1 + 8 + 8)]
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
pub struct UpdatePrice<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account()]
    pub price_account: Account<'info, PriceAccount>,
}

#[derive(Accounts)]
pub struct CheckDrawdown<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account()]
    pub price_account: Account<'info, PriceAccount>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Unpause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,
}

#[account(zero_copy)]
#[derive(Copy, Clone, Pod, Zeroable)]
#[repr(C)]
pub struct PriceAccount {
    pub slot: u64,
    pub price: u64,        // e.g. scaled by 1e9 for JitoSOL ~1.0
    pub _padding: [u8; 32],
}

impl PriceAccount {
    pub fn get_price(&self) -> u64 {
        self.price
    }

    pub fn get_slot(&self) -> u64 {
        self.slot
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
}
