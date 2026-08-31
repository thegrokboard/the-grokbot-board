use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};

declare_id!("Vau1tX1J2pX1oQJ2pX1oQJ2pX1oQJ2pX1oQJ2pX1oQ");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, oracle: Pubkey, jito_mint: Pubkey) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.oracle = oracle;
        vault.jito_mint = jito_mint;
        vault.is_paused = false;
        vault.protection_buffer = ctx.accounts.protection_buffer.key();
        vault.last_twap = 0;
        vault.last_update_slot = Clock::get()?.slot;
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

    pub fn update_twap(ctx: Context<UpdateTwap>, new_twap: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let clock = Clock::get()?;
        require!(!vault.is_paused, ErrorCode::VaultPaused);
        require_keys_eq!(ctx.accounts.oracle.key(), vault.oracle, ErrorCode::InvalidOracle);

        vault.last_twap = new_twap;
        vault.last_update_slot = clock.slot;

        let drawdown = if new_twap == 0 { 0 } else { (1_000_000u64.saturating_sub(new_twap)) * 100 / 1_000_000 };
        if drawdown > 150 { // 15% drawdown triggers breaker
            vault.is_paused = true;
            emit!(CircuitBreakerTripped {
                twap: new_twap,
                drawdown,
                slot: clock.slot,
            });
        }

        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(ctx.accounts.owner.key(), vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require_keys_eq!(ctx.accounts.owner.key(), vault.owner, ErrorCode::Unauthorized);
        require!(vault.is_paused || amount <= 100_000_000, ErrorCode::Unauthorized); // allow emergency withdraw when paused

        let seeds = &[b"vault".as_ref(), &[ctx.bumps.vault]];
        let signer = &[&seeds[..]];

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.vault_jito_account.to_account_info(),
            to: ctx.accounts.recipient_jito_account.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 32 + 32 + 32 + 1 + 32 + 8 + 8, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    #[account(init, payer = payer, space = 8 + 8, seeds = [b"buffer"], bump)]
    pub protection_buffer: Account<'info, ProtectionBuffer>,
    pub oracle: AccountInfo<'info>,
    pub jito_mint: Account<'info, Mint>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub user_jito_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_jito_account: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateTwap<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    pub oracle: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub vault_jito_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub recipient_jito_account: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub oracle: Pubkey,
    pub jito_mint: Pubkey,
    pub is_paused: bool,
    pub protection_buffer: Pubkey,
    pub last_twap: u64,
    pub last_update_slot: u64,
}

#[account]
pub struct ProtectionBuffer {
    pub reserved: u64,
}

#[event]
pub struct CircuitBreakerTripped {
    pub twap: u64,
    pub drawdown: u64,
    pub slot: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid oracle")]
    InvalidOracle,
}
