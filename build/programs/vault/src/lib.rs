use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("Vault1111111111111111111111111111111111111111");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.buffer_bump = buffer_bump;
        vault.paused = false;
        vault.last_twap = 0;
        vault.last_update_slot = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.paused, VaultError::VaultPaused);

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

    pub fn update_twap(ctx: Context<UpdateTwap>, new_twap: u64, slot: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.paused, VaultError::VaultPaused);

        vault.last_twap = new_twap;
        vault.last_update_slot = slot;
        Ok(())
    }

    pub fn check_drawdown(ctx: Context<CheckDrawdown>, current_price: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.paused, VaultError::VaultPaused);

        let drawdown = if vault.last_twap > current_price {
            ((vault.last_twap - current_price) * 10000) / vault.last_twap
        } else {
            0
        };

        if drawdown > 500 {
            vault.paused = true;
            msg!("Circuit breaker tripped! Drawdown: {}%", drawdown);
        }
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, VaultError::Unauthorized);
        vault.paused = true;
        msg!("Vault paused by owner");
        Ok(())
    }

    pub fn withdraw_buffer(ctx: Context<WithdrawBuffer>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, VaultError::Unauthorized);
        require!(vault.paused, VaultError::NotPaused);

        let seeds = &[b"buffer".as_ref(), &[vault.buffer_bump]];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.buffer_token.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.buffer_token.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 32 + 1 + 1 + 8 + 8)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
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
    pub vault: Account<'info, VaultState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CheckDrawdown<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawBuffer<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub buffer_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct VaultState {
    pub owner: Pubkey,
    pub buffer_bump: u8,
    pub paused: bool,
    pub last_twap: u64,
    pub last_update_slot: u64,
}

#[error_code]
pub enum VaultError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Vault must be paused to withdraw buffer")]
    NotPaused,
}
