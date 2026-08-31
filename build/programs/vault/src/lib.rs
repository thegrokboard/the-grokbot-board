use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, buffer_bump: u8) -> Result<()> {
        let buffer = &mut ctx.accounts.buffer;
        buffer.owner = *ctx.accounts.owner.key;
        buffer.buffer_amount = 0;
        buffer.is_paused = false;
        buffer.bump = buffer_bump;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let cpi_accounts = token::Transfer {
            from: ctx.accounts.user_token.to_account_info(),
            to: ctx.accounts.vault_token.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        let buffer = &mut ctx.accounts.buffer;
        buffer.buffer_amount = buffer.buffer_amount.checked_add(amount).unwrap();
        Ok(())
    }

    pub fn drawdown(ctx: Context<Drawdown>, amount: u64) -> Result<()> {
        let buffer = &mut ctx.accounts.buffer;
        require!(!buffer.is_paused, ErrorCode::VaultPaused);
        require!(buffer.buffer_amount >= amount, ErrorCode::InsufficientBuffer);

        let signer_seeds: &[&[&[u8]]] = &[&[b"buffer", &[buffer.bump]]];
        let cpi_accounts = token::Transfer {
            from: ctx.accounts.vault_token.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.buffer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        token::transfer(cpi_ctx, amount)?;

        buffer.buffer_amount = buffer.buffer_amount.checked_sub(amount).unwrap();
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let buffer = &mut ctx.accounts.buffer;
        require!(ctx.accounts.owner.key() == buffer.owner, ErrorCode::Unauthorized);
        buffer.is_paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<Pause>) -> Result<()> {
        let buffer = &mut ctx.accounts.buffer;
        require!(ctx.accounts.owner.key() == buffer.owner, ErrorCode::Unauthorized);
        buffer.is_paused = false;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let buffer = &mut ctx.accounts.buffer;
        require!(ctx.accounts.owner.key() == buffer.owner, ErrorCode::Unauthorized);
        require!(buffer.buffer_amount >= amount, ErrorCode::InsufficientBuffer);

        let signer_seeds: &[&[&[u8]]] = &[&[b"buffer", &[buffer.bump]]];
        let cpi_accounts = token::Transfer {
            from: ctx.accounts.vault_token.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.buffer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        token::transfer(cpi_ctx, amount)?;

        buffer.buffer_amount = buffer.buffer_amount.checked_sub(amount).unwrap();
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(buffer_bump: u8)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 8 + 1 + 1,
        seeds = [b"buffer"],
        bump = buffer_bump
    )]
    pub buffer: Account<'info, ProtectionBuffer>,
    pub jito_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = owner,
        token::mint = jito_mint,
        token::authority = buffer,
        seeds = [b"vault"],
        bump
    )]
    pub vault_token: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"buffer"],
        bump = buffer.bump
    )]
    pub buffer: Account<'info, ProtectionBuffer>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Drawdown<'info> {
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"buffer"],
        bump = buffer.bump,
        has_one = owner
    )]
    pub buffer: Account<'info, ProtectionBuffer>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(
        mut,
        seeds = [b"buffer"],
        bump = buffer.bump,
        has_one = owner
    )]
    pub buffer: Account<'info, ProtectionBuffer>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"buffer"],
        bump = buffer.bump,
        has_one = owner
    )]
    pub buffer: Account<'info, ProtectionBuffer>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct ProtectionBuffer {
    pub owner: Pubkey,
    pub buffer_amount: u64,
    pub is_paused: bool,
    pub bump: u8,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Insufficient buffer balance")]
    InsufficientBuffer,
    #[msg("Unauthorized")]
    Unauthorized,
}
