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
        vault.last_twap_slot = 0;
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

    pub fn update_price(ctx: Context<UpdatePrice>) -> Result<()> {
        let clock = Clock::get()?;
        let price_account = &ctx.accounts.price_account;
        let vault = &mut ctx.accounts.vault;

        let current_price = price_account.price;
        let slot = clock.slot;

        // Simple 15s TWAP approximation using recent slot (target ~45 slots at 400ms)
        let twap = if vault.last_twap_slot == 0 {
            current_price
        } else {
            (vault.last_twap + current_price) / 2
        };

        vault.last_twap = twap;
        vault.last_twap_slot = slot;
        Ok(())
    }

    pub fn check_drawdown(ctx: Context<CheckDrawdown>, max_drawdown_bps: u16) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        let clock = Clock::get()?;
        let price_account = &ctx.accounts.price_account;

        let current_price = price_account.price;
        let twap = vault.last_twap;

        if twap == 0 {
            return Ok(());
        }

        let drawdown = if current_price < twap {
            ((twap - current_price) * 10000) / twap
        } else {
            0
        };

        if drawdown > max_drawdown_bps as u64 {
            // Trigger circuit breaker: pause vault
            let vault = &mut ctx.accounts.vault;
            vault.is_paused = true;
            msg!("Circuit breaker triggered! Drawdown {} bps", drawdown);
        }

        Ok(())
    }

    pub fn pause(ctx: Context<OwnerAction>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<OwnerAction>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = false;
        Ok(())
    }

    pub fn withdraw_buffer(ctx: Context<WithdrawBuffer>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        require!(vault.is_paused, ErrorCode::NotPaused);

        let seeds = &[b"buffer".as_ref(), &[vault.buffer_bump]];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
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

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub buffer_bump: u8,
    pub is_paused: bool,
    pub last_twap: u64,
    pub last_twap_slot: u64,
}

#[account]
#[derive(Default)]
pub struct PriceAccount {
    pub price: u64,        // scaled price (e.g. 1e9 = $1)
    pub slot: u64,
    pub updated_at: i64,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 32 + 1 + 1 + 8 + 8)]
    pub vault: Account<'info, Vault>,
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
    #[account(mut)]
    pub vault_token: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdatePrice<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub price_account: Account<'info, PriceAccount>,
}

#[derive(Accounts)]
pub struct CheckDrawdown<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub price_account: Account<'info, PriceAccount>,
}

#[derive(Accounts)]
pub struct OwnerAction<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawBuffer<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    /// CHECK: PDA signer
    #[account(seeds = [b"buffer"], bump = vault.buffer_bump)]
    pub buffer: AccountInfo<'info>,
    #[account(mut)]
    pub buffer_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault must be paused to withdraw buffer")]
    NotPaused,
}
