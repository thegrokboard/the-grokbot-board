use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = *ctx.accounts.owner.key;
        vault.jito_mint = ctx.accounts.jito_mint.key();
        vault.protection_buffer = ctx.accounts.protection_buffer.key();
        vault.is_paused = false;
        vault.bump = bump;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.user_jito_account.to_account_info(),
            to: ctx.accounts.vault_jito_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn drawdown(ctx: Context<Drawdown>) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        let price = ctx.accounts.oracle.load()?.price;
        let buffer_amount = ctx.accounts.protection_buffer.amount;

        // Simple drawdown circuit breaker logic for sim (trip if price < 0.9)
        if price < 90_000_000 {
            // In a real system this would trigger a breaker event; here we just pause
            let vault = &mut ctx.accounts.vault;
            vault.is_paused = true;
            return Err(ErrorCode::CircuitBreakerTripped.into());
        }

        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = false;
        Ok(())
    }

    pub fn withdraw_buffer(ctx: Context<WithdrawBuffer>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        let seeds = &[b"vault".as_ref(), &[vault.bump]];
        let signer = &[&seeds[..]];

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.vault_jito_account.to_account_info(),
            to: ctx.accounts.owner_jito_account.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 32 + 32 + 1 + 1,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub jito_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = owner,
        seeds = [b"buffer"],
        bump,
        token::mint = jito_mint,
        token::authority = vault
    )]
    pub protection_buffer: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        seeds = [b"vault"],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_jito_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_jito_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Drawdown<'info> {
    #[account(
        seeds = [b"vault"],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub protection_buffer: Account<'info, TokenAccount>,
    /// CHECK: oracle loaded in handler
    pub oracle: AccountLoader<'info, OraclePrice>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(
        mut,
        seeds = [b"vault"],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawBuffer<'info> {
    #[account(
        seeds = [b"vault"],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub owner_jito_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_jito_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub jito_mint: Pubkey,
    pub protection_buffer: Pubkey,
    pub is_paused: bool,
    pub bump: u8,
}

#[account(zero_copy)]
pub struct OraclePrice {
    pub price: i64,
    // padding to simulate Switchboard/Jito oracle layout for sim
    pub _padding: [u8; 64],
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Circuit breaker tripped")]
    CircuitBreakerTripped,
    #[msg("Unauthorized")]
    Unauthorized,
}
