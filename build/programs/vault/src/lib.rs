use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("Vault1111111111111111111111111111111111111111");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, max_drawdown_bps: u16) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.jito_mint = ctx.accounts.jito_mint.key();
        vault.protection_buffer = ctx.accounts.protection_buffer.key();
        vault.max_drawdown_bps = max_drawdown_bps;
        vault.is_paused = false;
        vault.last_twap_price = 0;
        vault.last_twap_slot = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, VaultError::VaultPaused);

        let cpi_accounts = Transfer {
            from: ctx.accounts.user_jito_account.to_account_info(),
            to: ctx.accounts.vault_jito_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Record deposit (no shares for simplicity in sim)
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, VaultError::VaultPaused);

        let seeds = &[b"vault".as_ref(), &[ctx.bumps.vault]];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_jito_account.to_account_info(),
            to: ctx.accounts.user_jito_account.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, VaultError::Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, VaultError::Unauthorized);
        vault.is_paused = false;
        Ok(())
    }

    pub fn update_twap(ctx: Context<UpdateTwap>, new_price: u64, slot: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, VaultError::VaultPaused);

        // Simple 15s TWAP false-positive logic stub (real check happens off-chain via sim)
        let drawdown = if vault.last_twap_price > 0 && new_price < vault.last_twap_price {
            ((vault.last_twap_price - new_price) * 10000 / vault.last_twap_price) as u16
        } else {
            0
        };

        if drawdown > vault.max_drawdown_bps {
            // Trigger circuit breaker by pausing
            vault.is_paused = true;
        }

        vault.last_twap_price = new_price;
        vault.last_twap_slot = slot;
        Ok(())
    }

    pub fn withdraw_from_buffer(ctx: Context<WithdrawFromBuffer>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, VaultError::Unauthorized);
        require!(!vault.is_paused, VaultError::VaultPaused);

        let seeds = &[b"buffer".as_ref(), &[ctx.bumps.protection_buffer]];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.protection_buffer.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.protection_buffer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 256, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    pub jito_mint: Account<'info, Mint>,
    #[account(init, payer = payer, token::mint = jito_mint, token::authority = protection_buffer, seeds = [b"buffer"], bump)]
    pub protection_buffer: Account<'info, TokenAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub user_jito_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = vault_jito_account.mint == vault.jito_mint)]
    pub vault_jito_account: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub user_jito_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = vault_jito_account.mint == vault.jito_mint)]
    pub vault_jito_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Unpause<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateTwap<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    // Oracle / admin signer omitted for sim simplicity
}

#[derive(Accounts)]
pub struct WithdrawFromBuffer<'info> {
    #[account(seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    #[account(mut, seeds = [b"buffer"], bump)]
    pub protection_buffer: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct VaultState {
    pub owner: Pubkey,
    pub jito_mint: Pubkey,
    pub protection_buffer: Pubkey,
    pub max_drawdown_bps: u16,
    pub is_paused: bool,
    pub last_twap_price: u64,
    pub last_twap_slot: u64,
}

#[error_code]
pub enum VaultError {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Drawdown limit exceeded")]
    DrawdownExceeded,
}
