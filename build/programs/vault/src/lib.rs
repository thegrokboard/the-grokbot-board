use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::{self, Sysvar};
use bytemuck::{Pod, Zeroable};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.jito_sol_mint = ctx.accounts.jito_sol_mint.key();
        vault.buffer_bump = buffer_bump;
        vault.is_paused = false;
        vault.last_twap = 0;
        vault.last_update_slot = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, VaultError::VaultPaused);

        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.user_token.to_account_info(),
            to: ctx.accounts.vault_token.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        );
        anchor_spl::token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn drawdown(ctx: Context<Drawdown>) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, VaultError::VaultPaused);

        let clock = Clock::get()?;
        let current_slot = clock.slot;

        // Protection buffer drawdown logic (simple placeholder for circuit breaker)
        let protection_buffer = &mut ctx.accounts.protection_buffer;
        protection_buffer.last_drawdown_slot = current_slot;

        Ok(())
    }

    pub fn update_twap(ctx: Context<UpdateTwap>, new_twap: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, VaultError::VaultPaused);

        let clock = Clock::get()?;
        vault.last_twap = new_twap;
        vault.last_update_slot = clock.slot;

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

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, VaultError::Unauthorized);
        require!(vault.is_paused, VaultError::VaultNotPaused);

        let seeds = &[b"vault".as_ref(), &[vault.buffer_bump]];
        let signer = &[&seeds[..]];

        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.vault_token.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer,
        );
        anchor_spl::token::transfer(cpi_ctx, amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 128, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    pub jito_sol_mint: Account<'info, anchor_spl::token::Mint>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub user_token: Account<'info, anchor_spl::token::TokenAccount>,
    #[account(mut)]
    pub vault_token: Account<'info, anchor_spl::token::TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, anchor_spl::token::Token>,
}

#[derive(Accounts)]
pub struct Drawdown<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub protection_buffer: Account<'info, ProtectionBuffer>,
    pub oracle: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct UpdateTwap<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub oracle: UncheckedAccount<'info>,
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
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub vault_token: Account<'info, anchor_spl::token::TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, anchor_spl::token::TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, anchor_spl::token::Token>,
}

#[account]
#[derive(Default)]
pub struct Vault {
    pub owner: Pubkey,
    pub jito_sol_mint: Pubkey,
    pub buffer_bump: u8,
    pub is_paused: bool,
    pub last_twap: u64,
    pub last_update_slot: u64,
}

#[account]
#[derive(Default)]
pub struct ProtectionBuffer {
    pub last_drawdown_slot: u64,
    pub reserved: [u8; 64],
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone, Copy, PartialEq, Eq, Pod, Zeroable)]
#[repr(C)]
pub struct PriceData {
    pub price: u64,
    pub confidence: u64,
    pub expo: i32,
    pub publish_time: i64,
}

#[error_code]
pub enum VaultError {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Vault is not paused")]
    VaultNotPaused,
    #[msg("Unauthorized owner")]
    Unauthorized,
    #[msg("Circuit breaker tripped")]
    CircuitBreakerTripped,
}
