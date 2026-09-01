use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.paused = false;
        vault.buffer_bump = *ctx.bumps.get("buffer").unwrap();
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.paused, ErrorCode::VaultPaused);

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.user_token.to_account_info(),
            to: ctx.accounts.vault_token.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // simplistic buffer top-up simulation
        let buffer = &mut ctx.accounts.buffer;
        buffer.lamports = buffer.lamports.saturating_add(amount as u128);

        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.signer.key() == vault.owner, ErrorCode::Unauthorized);
        vault.paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.signer.key() == vault.owner, ErrorCode::Unauthorized);
        vault.paused = false;
        Ok(())
    }

    pub fn withdraw_buffer(ctx: Context<WithdrawBuffer>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.signer.key() == vault.owner, ErrorCode::Unauthorized);
        require!(!vault.paused, ErrorCode::VaultPaused);

        let buffer = &mut ctx.accounts.buffer;
        require!(buffer.lamports >= amount as u128, ErrorCode::InsufficientBuffer);

        let seeds = &[
            b"buffer".as_ref(),
            vault.to_account_info().key.as_ref(),
            &[vault.buffer_bump],
        ];
        let signer = &[&seeds[..]];

        **buffer.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.destination.try_borrow_mut_lamports()? += amount;

        Ok(())
    }

    pub fn drawdown_breaker(ctx: Context<DrawdownBreaker>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.paused, ErrorCode::VaultPaused);

        // simplistic circuit breaker trip
        vault.paused = true;
        msg!("Drawdown circuit breaker tripped - vault paused");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = signer, space = 8 + 8 + 1 + 1 + 32)]
    pub vault: Account<'info, Vault>,
    #[account(
        init,
        seeds = [b"buffer", vault.key().as_ref()],
        bump,
        payer = signer,
        space = 8 + 16
    )]
    pub buffer: Account<'info, ProtectionBuffer>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [b"buffer", vault.key().as_ref()], bump = vault.buffer_bump)]
    pub buffer: Account<'info, ProtectionBuffer>,
    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawBuffer<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [b"buffer", vault.key().as_ref()], bump = vault.buffer_bump)]
    pub buffer: Account<'info, ProtectionBuffer>,
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct DrawdownBreaker<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub oracle: UncheckedAccount<'info>, // price feed placeholder
    pub signer: Signer<'info>,
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub paused: bool,
    pub buffer_bump: u8,
}

#[account]
pub struct ProtectionBuffer {
    pub lamports: u128,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Insufficient buffer balance")]
    InsufficientBuffer,
}
