use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use bytemuck::{Pod, Zeroable};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.jito_sol_mint = ctx.accounts.jito_sol_mint.key();
        vault.protection_buffer = ctx.accounts.protection_buffer.key();
        vault.buffer_bump = buffer_bump;
        vault.is_paused = false;
        vault.last_twap = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let user = &ctx.accounts.user;
        let vault = &ctx.accounts.vault;
        let user_token = &ctx.accounts.user_token;
        let vault_token = &ctx.accounts.vault_token;
        let token_program = &ctx.accounts.token_program;

        require!(!vault.is_paused, VaultError::VaultPaused);

        let cpi_accounts = token::Transfer {
            from: user_token.to_account_info(),
            to: vault_token.to_account_info(),
            authority: user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, VaultError::Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, VaultError::Unauthorized);
        vault.is_paused = false;
        Ok(())
    }

    pub fn withdraw_buffer(ctx: Context<WithdrawBuffer>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        let owner = &ctx.accounts.owner;
        let buffer = &ctx.accounts.protection_buffer;
        let destination = &ctx.accounts.destination;

        require!(owner.key() == vault.owner, VaultError::Unauthorized);
        require!(!vault.is_paused, VaultError::VaultPaused);

        let seeds = &[b"buffer".as_ref(), &[vault.buffer_bump]];
        let signer = &[&seeds[..]];

        let cpi_accounts = token::Transfer {
            from: buffer.to_account_info(),
            to: destination.to_account_info(),
            authority: buffer.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer,
        );
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn trigger_drawdown(ctx: Context<TriggerDrawdown>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let buffer = &mut ctx.accounts.protection_buffer.load_mut()?;

        require!(!vault.is_paused, VaultError::VaultPaused);

        // Simple drawdown circuit breaker: reduce buffer by 10% on trigger
        let current = buffer.buffer_amount;
        buffer.buffer_amount = current.saturating_sub(current / 10);
        vault.last_twap = Clock::get()?.unix_timestamp as u64;

        Ok(())
    }

    pub fn update_twap(ctx: Context<UpdateTwap>, new_twap: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, VaultError::Unauthorized);
        vault.last_twap = new_twap;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 8 + 32 + 32 + 32 + 1 + 8)]
    pub vault: Account<'info, VaultState>,
    pub jito_sol_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = payer,
        seeds = [b"buffer"],
        bump,
        token::mint = jito_sol_mint,
        token::authority = protection_buffer,
    )]
    pub protection_buffer: Account<'info, TokenAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawBuffer<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"buffer"],
        bump = vault.buffer_bump,
        constraint = protection_buffer.mint == vault.jito_sol_mint
    )]
    pub protection_buffer: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct TriggerDrawdown<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    #[account(
        mut,
        seeds = [b"protection_buffer"],
        bump = vault.buffer_bump,
    )]
    pub protection_buffer: AccountLoader<'info, ProtectionBuffer>,
    pub oracle: UncheckedAccount<'info>, // placeholder for oracle in sim
}

#[derive(Accounts)]
pub struct UpdateTwap<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub owner: Signer<'info>,
}

#[account]
#[derive(Default)]
pub struct VaultState {
    pub owner: Pubkey,
    pub jito_sol_mint: Pubkey,
    pub protection_buffer: Pubkey,
    pub buffer_bump: u8,
    pub is_paused: bool,
    pub last_twap: u64,
}

#[account(zero_copy)]
#[derive(Copy, Clone, Pod, Zeroable)]
#[repr(C)]
pub struct ProtectionBuffer {
    pub buffer_amount: u64,
    pub last_update_slot: u64,
    pub padding: [u8; 48], // to reach 64 bytes for Pod alignment
}

impl Default for ProtectionBuffer {
    fn default() -> Self {
        Self {
            buffer_amount: 0,
            last_update_slot: 0,
            padding: [0; 48],
        }
    }
}

#[error_code]
pub enum VaultError {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized owner")]
    Unauthorized,
    #[msg("Drawdown circuit breaker triggered")]
    DrawdownTriggered,
}
