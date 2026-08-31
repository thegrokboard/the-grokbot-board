use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, oracle: Pubkey) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.oracle = oracle;
        vault.jitosol_mint = ctx.accounts.jitosol_mint.key();
        vault.paused = false;
        vault.protection_buffer = 0;
        vault.last_price = 0;
        vault.last_price_slot = 0;
        vault.drawdown_threshold = 500; // 5% in basis points
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.paused, ErrorCode::VaultPaused);

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.user_jitosol.to_account_info(),
            to: ctx.accounts.vault_jitosol.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // simplistic buffer tracking
        vault.protection_buffer = vault.protection_buffer.saturating_add(amount);

        emit!(DepositEvent {
            user: ctx.accounts.user.key(),
            amount,
        });

        Ok(())
    }

    pub fn update_price(ctx: Context<UpdatePrice>, price: u64, slot: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.paused, ErrorCode::VaultPaused);
        require_keys_eq!(ctx.accounts.oracle.key(), vault.oracle, ErrorCode::InvalidOracle);

        // basic drawdown check
        if vault.last_price > 0 {
            let drawdown = if price < vault.last_price {
                ((vault.last_price - price) * 10000) / vault.last_price
            } else {
                0
            };
            if drawdown > vault.drawdown_threshold {
                vault.paused = true;
                emit!(CircuitBreakerTripped {
                    current_price: price,
                    previous_price: vault.last_price,
                    drawdown_bps: drawdown,
                });
            }
        }

        vault.last_price = price;
        vault.last_price_slot = slot;
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(ctx.accounts.owner.key(), vault.owner, ErrorCode::Unauthorized);
        vault.paused = true;
        emit!(Paused { by: ctx.accounts.owner.key() });
        Ok(())
    }

    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(ctx.accounts.owner.key(), vault.owner, ErrorCode::Unauthorized);
        vault.paused = false;
        emit!(Unpaused { by: ctx.accounts.owner.key() });
        Ok(())
    }

    pub fn withdraw_buffer(ctx: Context<WithdrawBuffer>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(ctx.accounts.owner.key(), vault.owner, ErrorCode::Unauthorized);
        require!(amount <= vault.protection_buffer, ErrorCode::InsufficientBuffer);

        let seeds = &[b"vault".as_ref(), &[ctx.bumps.vault]];
        let signer = &[&seeds[..]];

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.vault_jitosol.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        vault.protection_buffer = vault.protection_buffer.saturating_sub(amount);

        emit!(BufferWithdrawn {
            amount,
            destination: ctx.accounts.destination.key(),
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 256, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    pub jitosol_mint: Account<'info, Mint>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub user_jitosol: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_jitosol: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdatePrice<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub oracle: Signer<'info>,
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
pub struct WithdrawBuffer<'info> {
    #[account(mut, has_one = owner)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub vault_jitosol: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub oracle: Pubkey,
    pub jitosol_mint: Pubkey,
    pub paused: bool,
    pub protection_buffer: u64,
    pub last_price: u64,        // scaled price (e.g. 1e9)
    pub last_price_slot: u64,
    pub drawdown_threshold: u64, // in basis points
}

#[event]
pub struct DepositEvent {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct CircuitBreakerTripped {
    pub current_price: u64,
    pub previous_price: u64,
    pub drawdown_bps: u64,
}

#[event]
pub struct Paused {
    pub by: Pubkey,
}

#[event]
pub struct Unpaused {
    pub by: Pubkey,
}

#[event]
pub struct BufferWithdrawn {
    pub amount: u64,
    pub destination: Pubkey,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid oracle")]
    InvalidOracle,
    #[msg("Insufficient protection buffer")]
    InsufficientBuffer,
}
