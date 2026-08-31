use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.buffer_bump = buffer_bump;
        vault.is_paused = false;
        vault.last_twap = 0;
        vault.accumulated_twap = 0;
        vault.tick_count = 0;
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

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        let seeds = &[b"vault".as_ref(), &[vault.bump]];
        let signer = &[&seeds[..]];

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.vault_token.to_account_info(),
            to: ctx.accounts.owner_token.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;
        Ok(())
    }

    pub fn drawdown_breaker(ctx: Context<DrawdownBreaker>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        // Simple drawdown logic based on TWAP (simplified for harness)
        let current_price = ctx.accounts.oracle.price;
        let twap = if vault.tick_count > 0 {
            vault.accumulated_twap / vault.tick_count as u64
        } else {
            current_price
        };

        let drawdown = if twap > 0 && current_price < twap {
            ((twap - current_price) as u128 * 10000) / twap as u128
        } else {
            0
        };

        if drawdown > 500 { // 5% drawdown threshold
            vault.is_paused = true;
        }

        vault.last_twap = current_price;
        vault.accumulated_twap += current_price;
        vault.tick_count += 1;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 32 + 1 + 1 + 8 + 8 + 4)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    #[account(mut)]
    pub buffer_token: Account<'info, TokenAccount>,
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
pub struct Pause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, has_one = owner)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub owner_token: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct DrawdownBreaker<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    /// CHECK: oracle price feed (simplified JitoSOL oracle)
    pub oracle: AccountInfo<'info>,
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub bump: u8,
    pub buffer_bump: u8,
    pub is_paused: bool,
    pub last_twap: u64,
    pub accumulated_twap: u64,
    pub tick_count: u32,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Drawdown circuit breaker tripped")]
    BreakerTripped,
}
