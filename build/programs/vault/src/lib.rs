use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.jito_sol_mint = ctx.accounts.jito_sol_mint.key();
        vault.buffer_bump = buffer_bump;
        vault.is_paused = false;
        vault.last_twap = 0;
        vault.last_twap_slot = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

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

    pub fn drawdown(ctx: Context<Drawdown>, twap: u64, current_slot: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        // Simple drawdown circuit breaker: if TWAP depegged >5% from 1.0 (scaled 1e9)
        let depeg_threshold: u64 = 950_000_000; // 0.95
        if twap < depeg_threshold {
            vault.is_paused = true;
            msg!("Circuit breaker tripped: TWAP {}", twap);
            return Err(ErrorCode::DrawdownDetected.into());
        }

        vault.last_twap = twap;
        vault.last_twap_slot = current_slot;
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn withdraw_buffer(ctx: Context<WithdrawBuffer>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        require!(vault.is_paused, ErrorCode::VaultNotPaused);

        let bump = vault.buffer_bump;
        let seeds = &[b"buffer".as_ref(), &[bump]];
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
#[instruction(owner: Pubkey, buffer_bump: u8)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 32 + 32 + 1 + 1 + 8 + 8)]
    pub vault: Account<'info, VaultState>,
    pub jito_sol_mint: Account<'info, Mint>,
    #[account(
        init,
        seeds = [b"buffer"],
        bump = buffer_bump,
        payer = payer,
        token::mint = jito_sol_mint,
        token::authority = buffer,
    )]
    pub buffer_token: Account<'info, TokenAccount>,
    /// CHECK: PDA authority for buffer
    #[account(seeds = [b"buffer"], bump = buffer_bump)]
    pub buffer: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
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
pub struct Drawdown<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub oracle: UncheckedAccount<'info>, // simulated oracle feed
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawBuffer<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub buffer_token: Account<'info, TokenAccount>,
    /// CHECK: PDA authority
    #[account(seeds = [b"buffer"], bump = vault.buffer_bump)]
    pub buffer: UncheckedAccount<'info>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(Default)]
pub struct VaultState {
    pub owner: Pubkey,
    pub jito_sol_mint: Pubkey,
    pub buffer_bump: u8,
    pub is_paused: bool,
    pub last_twap: u64,
    pub last_twap_slot: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Drawdown / depeg detected")]
    DrawdownDetected,
    #[msg("Vault must be paused for withdraw")]
    VaultNotPaused,
}
