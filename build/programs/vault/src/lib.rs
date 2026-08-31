use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

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
        vault.protection_buffer = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.user_token.to_account_info(),
            to: ctx.accounts.vault_token.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        vault.protection_buffer = vault.protection_buffer.checked_add(amount).unwrap();
        Ok(())
    }

    pub fn drawdown(ctx: Context<Drawdown>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);
        require!(amount <= vault.protection_buffer, ErrorCode::InsufficientBuffer);

        let seeds = &[
            b"vault".as_ref(),
            &[vault.buffer_bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.vault_token.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        vault.protection_buffer = vault.protection_buffer.checked_sub(amount).unwrap();
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = false;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);

        let seeds = &[
            b"vault".as_ref(),
            &[vault.buffer_bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.vault_token.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        vault.protection_buffer = vault.protection_buffer.checked_sub(amount).unwrap();
        Ok(())
    }

    pub fn trigger_circuit_breaker(ctx: Context<TriggerCircuitBreaker>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);
        vault.is_paused = true;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(owner: Pubkey, buffer_bump: u8)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 32 + 1 + 8 + 1,
        seeds = [b"vault"],
        bump,
    )]
    pub vault: Account<'info, Vault>,
    pub jito_sol_mint: Account<'info, Mint>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"vault"],
        bump = vault.buffer_bump,
    )]
    pub vault_token: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Drawdown<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        seeds = [b"vault"],
        bump = vault.buffer_bump,
    )]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
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
    #[account(
        mut,
        seeds = [b"vault"],
        bump = vault.buffer_bump,
    )]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct TriggerCircuitBreaker<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    // Oracle / TWAP account would be added here in full version
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub jito_sol_mint: Pubkey,
    pub buffer_bump: u8,
    pub is_paused: bool,
    pub protection_buffer: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Insufficient protection buffer")]
    InsufficientBuffer,
    #[msg("Unauthorized")]
    Unauthorized,
}
