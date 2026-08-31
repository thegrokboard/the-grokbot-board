use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bps: u16) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.buffer_bps = buffer_bps;
        vault.paused = false;
        vault.total_deposited = 0;
        vault.last_twap = 0;
        vault.last_update_slot = Clock::get()?.slot;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.paused, ErrorCode::Paused);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.user_token.to_account_info(),
                    to: ctx.accounts.vault_token.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        vault.total_deposited = vault.total_deposited.checked_add(amount).unwrap();
        Ok(())
    }

    pub fn drawdown_circuit_breaker(ctx: Context<DrawdownCircuitBreaker>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let clock = Clock::get()?;
        let price = ctx.accounts.oracle.get_price()?;

        let twap = calculate_twap(vault.last_twap, vault.last_update_slot, price, clock.slot)?;

        require!(twap < 9500, ErrorCode::NoDrawdownDetected); // 5% drawdown threshold example

        // Protection buffer withdrawal (owner only in prod; simplified for sim)
        let buffer_amount = calculate_buffer_amount(vault.total_deposited, vault.buffer_bps);
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.vault_token.to_account_info(),
                    to: ctx.accounts.buffer_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[&[b"vault", &[ctx.bumps.vault]]],
            ),
            buffer_amount,
        )?;

        vault.total_deposited = vault.total_deposited.checked_sub(buffer_amount).unwrap();
        vault.last_twap = twap;
        vault.last_update_slot = clock.slot;

        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        vault.paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        vault.paused = false;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        require!(amount <= vault.total_deposited, ErrorCode::InsufficientFunds);

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.vault_token.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[&[b"vault", &[ctx.bumps.vault]]],
            ),
            amount,
        )?;

        vault.total_deposited = vault.total_deposited.checked_sub(amount).unwrap();
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 8 + 32 + 2 + 1 + 8 + 8 + 8, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub jito_mint: Account<'info, Mint>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"vault_token", vault.key().as_ref()], bump)]
    pub vault_token: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct DrawdownCircuitBreaker<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [b"vault_token", vault.key().as_ref()], bump)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub buffer_account: Account<'info, TokenAccount>,
    pub oracle: Account<'info, OracleStub>,
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
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [b"vault_token", vault.key().as_ref()], bump)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub buffer_bps: u16,
    pub paused: bool,
    pub total_deposited: u64,
    pub last_twap: u64,
    pub last_update_slot: u64,
}

#[account]
pub struct OracleStub {
    pub price: u64,
}

impl OracleStub {
    pub fn get_price(&self) -> Result<u64> {
        Ok(self.price)
    }
}

fn calculate_twap(_last_twap: u64, _last_slot: u64, current_price: u64, _current_slot: u64) -> Result<u64> {
    // Simplified for sim harness: return current price scaled to basis points
    Ok(current_price)
}

fn calculate_buffer_amount(deposited: u64, bps: u16) -> u64 {
    deposited.saturating_mul(bps as u64) / 10_000
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    Paused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("No drawdown detected")]
    NoDrawdownDetected,
    #[msg("Insufficient funds")]
    InsufficientFunds,
}
