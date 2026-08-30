use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("Vault1111111111111111111111111111111111111111");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, max_drawdown_bps: u16) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.max_drawdown_bps = max_drawdown_bps;
        vault.is_paused = false;
        vault.last_twap = 0;
        vault.last_update_slot = Clock::get()?.slot;
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

        emit!(DepositEvent {
            user: ctx.accounts.user.key(),
            amount,
        });

        Ok(())
    }

    pub fn update_twap(ctx: Context<UpdateTwap>, new_twap: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let clock = Clock::get()?;

        require!(!vault.is_paused, ErrorCode::VaultPaused);
        require!(clock.slot > vault.last_update_slot, ErrorCode::InvalidSlot);

        let drawdown = if new_twap < vault.last_twap && vault.last_twap > 0 {
            ((vault.last_twap - new_twap) as u128 * 10000) / vault.last_twap as u128
        } else {
            0
        };

        if drawdown > vault.max_drawdown_bps as u128 {
            vault.is_paused = true;
            emit!(CircuitBreakerTripped {
                previous_twap: vault.last_twap,
                new_twap,
                drawdown_bps: drawdown as u16,
                slot: clock.slot,
            });
        } else {
            vault.last_twap = new_twap;
            vault.last_update_slot = clock.slot;
            emit!(TwapUpdated {
                new_twap,
                slot: clock.slot,
            });
        }

        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = true;
        emit!(VaultPausedEvent { by: ctx.accounts.authority.key() });
        Ok(())
    }

    pub fn withdraw_buffer(ctx: Context<WithdrawBuffer>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, ErrorCode::Unauthorized);
        require!(vault.is_paused, ErrorCode::NotPaused);

        let seeds = &[b"vault".as_ref(), &[ctx.bumps.vault]];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        emit!(OwnerWithdrawEvent {
            owner: ctx.accounts.authority.key(),
            amount,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 32 + 2 + 1 + 8 + 8, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub jito_mint: Account<'info, Mint>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,
    #[account(mut, constraint = vault_token.mint == vault.jito_mint)]
    pub vault_token: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub jito_mint: Account<'info, Mint>,
}

#[derive(Accounts)]
pub struct UpdateTwap<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    pub oracle: Signer<'info>, // simulated oracle signer in test validator
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawBuffer<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    #[account(mut, constraint = vault_token.mint == vault.jito_mint)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct VaultState {
    pub owner: Pubkey,
    pub max_drawdown_bps: u16,
    pub is_paused: bool,
    pub last_twap: u64,
    pub last_update_slot: u64,
    pub jito_mint: Pubkey,
}

#[event]
pub struct DepositEvent {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct CircuitBreakerTripped {
    pub previous_twap: u64,
    pub new_twap: u64,
    pub drawdown_bps: u16,
    pub slot: u64,
}

#[event]
pub struct TwapUpdated {
    pub new_twap: u64,
    pub slot: u64,
}

#[event]
pub struct VaultPausedEvent {
    pub by: Pubkey,
}

#[event]
pub struct OwnerWithdrawEvent {
    pub owner: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid slot")]
    InvalidSlot,
    #[msg("Vault must be paused for owner withdraw")]
    NotPaused,
}
