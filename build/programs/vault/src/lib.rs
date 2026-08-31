use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, max_drawdown_bps: u16, pause_duration: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.jito_sol_mint = ctx.accounts.jito_sol_mint.key();
        vault.buffer = ctx.accounts.buffer.key();
        vault.max_drawdown_bps = max_drawdown_bps;
        vault.pause_duration = pause_duration;
        vault.is_paused = false;
        vault.last_twap = 0;
        vault.last_update_slot = Clock::get()?.slot;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, VaultError::VaultPaused);

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

    pub fn update_twap(ctx: Context<UpdateTwap>, new_twap: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let clock = Clock::get()?;
        require!(!vault.is_paused, VaultError::VaultPaused);

        let drawdown = if vault.last_twap > new_twap {
            ((vault.last_twap - new_twap) as u128 * 10000 / vault.last_twap as u128) as u16
        } else {
            0
        };

        if drawdown > vault.max_drawdown_bps {
            vault.is_paused = true;
            vault.pause_start_slot = clock.slot;
            msg!("Circuit breaker triggered: drawdown {} bps", drawdown);
        }

        vault.last_twap = new_twap;
        vault.last_update_slot = clock.slot;
        Ok(())
    }

    pub fn withdraw_buffer(ctx: Context<WithdrawBuffer>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, VaultError::Unauthorized);

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.buffer_token.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.buffer.to_account_info(),
        };
        let seeds = &[b"buffer".as_ref(), &[ctx.bumps.buffer]];
        let signer = &[&seeds[..]];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer,
        );
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, VaultError::Unauthorized);
        vault.is_paused = true;
        vault.pause_start_slot = Clock::get()?.slot;
        Ok(())
    }

    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, VaultError::Unauthorized);
        let clock = Clock::get()?;
        if clock.slot > vault.pause_start_slot + vault.pause_duration {
            vault.is_paused = false;
            msg!("Vault unpaused after cooldown");
        } else {
            return err!(VaultError::CooldownNotMet);
        }
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 8 + 32 + 32 + 32 + 2 + 8 + 8 + 1 + 8)]
    pub vault: Account<'info, Vault>,
    #[account(init, payer = payer, space = 8, seeds = [b"buffer"], bump)]
    pub buffer: AccountInfo<'info>,
    pub jito_sol_mint: Account<'info, Mint>,
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
#[instruction(new_twap: u64)]
pub struct UpdateTwap<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawBuffer<'info> {
    #[account(has_one = owner)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [b"buffer"], bump)]
    pub buffer: AccountInfo<'info>,
    pub owner: Signer<'info>,
    #[account(mut)]
    pub buffer_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Unpause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,
}

#[account]
#[derive(Default)]
pub struct Vault {
    pub owner: Pubkey,
    pub jito_sol_mint: Pubkey,
    pub buffer: Pubkey,
    pub max_drawdown_bps: u16,
    pub pause_duration: u64,
    pub is_paused: bool,
    pub last_twap: u64,
    pub last_update_slot: u64,
    pub pause_start_slot: u64,
}

#[error_code]
pub enum VaultError {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Cooldown period not met")]
    CooldownNotMet,
}
