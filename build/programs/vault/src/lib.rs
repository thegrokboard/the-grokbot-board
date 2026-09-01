use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use bytemuck::{Pod, Zeroable};

declare_id!("Vau1tX1J2vK5m7pQ8wE9rT2yU3iO4pL5mN6oP7qR8s");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, max_drawdown_bps: u16) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.jito_mint = ctx.accounts.jito_mint.key();
        vault.buffer = ctx.accounts.buffer.key();
        vault.paused = false;
        vault.max_drawdown_bps = max_drawdown_bps;
        vault.last_twap = 0;
        vault.last_update_slot = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.paused, ErrorCode::VaultPaused);

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

    pub fn update_twap(ctx: Context<UpdateTwap>, new_twap: u64, current_slot: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.paused, ErrorCode::VaultPaused);
        require_keys_eq!(ctx.accounts.oracle.key(), vault.oracle, ErrorCode::InvalidOracle);

        let drawdown = if vault.last_twap == 0 {
            0
        } else if new_twap < vault.last_twap {
            ((vault.last_twap - new_twap) as u128 * 10000 / vault.last_twap as u128) as u16
        } else {
            0
        };

        if drawdown > vault.max_drawdown_bps {
            vault.paused = true;
            msg!("Circuit breaker tripped: drawdown {} bps > max {} bps", drawdown, vault.max_drawdown_bps);
        }

        vault.last_twap = new_twap;
        vault.last_update_slot = current_slot;
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(ctx.accounts.owner.key(), vault.owner, ErrorCode::Unauthorized);
        vault.paused = true;
        msg!("Vault paused by owner");
        Ok(())
    }

    pub fn withdraw_buffer(ctx: Context<WithdrawBuffer>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require_keys_eq!(ctx.accounts.owner.key(), vault.owner, ErrorCode::Unauthorized);
        require!(ctx.accounts.buffer_token.amount >= amount, ErrorCode::InsufficientBuffer);

        let seeds = &[b"buffer".as_ref(), &[ctx.bumps.buffer]];
        let signer = &[&seeds[..]];

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.buffer_token.to_account_info(),
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
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 128)]
    pub vault: Account<'info, Vault>,
    #[account(init, payer = payer, space = 8 + 32, seeds = [b"buffer"], bump)]
    pub buffer: AccountInfo<'info>,
    pub jito_mint: Account<'info, Mint>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub oracle: AccountInfo<'info>,
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
pub struct UpdateTwap<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub oracle: AccountInfo<'info>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawBuffer<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [b"buffer"], bump)]
    pub buffer: AccountInfo<'info>,
    #[account(mut)]
    pub buffer_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(Default)]
pub struct Vault {
    pub owner: Pubkey,
    pub jito_mint: Pubkey,
    pub buffer: Pubkey,
    pub oracle: Pubkey,
    pub paused: bool,
    pub max_drawdown_bps: u16,
    pub last_twap: u64,
    pub last_update_slot: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid oracle")]
    InvalidOracle,
    #[msg("Insufficient buffer balance")]
    InsufficientBuffer,
    #[msg("Drawdown circuit breaker tripped")]
    CircuitBreakerTripped,
}
