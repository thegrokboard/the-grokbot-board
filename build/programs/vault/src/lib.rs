use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("Vault11111111111111111111111111111111111111");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.is_paused = false;
        vault.buffer_bump = buffer_bump;
        vault.jito_sol_mint = ctx.accounts.jito_sol_mint.key();
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token.to_account_info(),
            to: ctx.accounts.vault_token.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn drawdown_check(ctx: Context<DrawdownCheck>, current_price: u64, twap_price: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        // Simple 15s TWAP drawdown circuit breaker: trip if current price is more than 10% below TWAP
        let threshold = twap_price * 9 / 10;
        if current_price < threshold {
            return Err(ErrorCode::DrawdownCircuitBreached.into());
        }

        // Update last check timestamp (sim uses slot time)
        let clock = Clock::get()?;
        vault.last_check_ts = clock.unix_timestamp;

        Ok(())
    }

    pub fn pause(ctx: Context<OwnerOnly>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.is_paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<OwnerOnly>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.is_paused = false;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, ErrorCode::Unauthorized);

        let seeds = &[
            b"buffer".as_ref(),
            &[vault.buffer_bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.buffer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(buffer_bump: u8)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 8 + 1 + 32 + 32 + 8)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub jito_sol_mint: Account<'info, token::Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct DrawdownCheck<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub oracle: AccountInfo<'info>, // price oracle account (sim injected)
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        seeds = [b"buffer"],
        bump = vault.buffer_bump,
    )]
    pub buffer: AccountInfo<'info>,
    #[account(mut)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub is_paused: bool,
    pub buffer_bump: u8,
    pub jito_sol_mint: Pubkey,
    pub last_check_ts: i64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Drawdown circuit breaker breached")]
    DrawdownCircuitBreached,
    #[msg("Unauthorized")]
    Unauthorized,
}
