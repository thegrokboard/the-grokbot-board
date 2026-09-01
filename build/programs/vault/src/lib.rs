use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = *ctx.accounts.owner.key;
        vault.jito_sol_mint = *ctx.accounts.jito_sol_mint.key;
        vault.buffer_bump = bump;
        vault.is_paused = false;
        vault.last_price = 0;
        vault.accumulated_drawdown = 0;
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

    pub fn drawdown_breaker(ctx: Context<DrawdownBreaker>, current_price: u64, twap: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        let drawdown = if twap > current_price {
            (twap - current_price) * 10000 / twap
        } else {
            0
        };

        vault.last_price = current_price;
        vault.accumulated_drawdown = drawdown;

        if drawdown > 500 { // 5% drawdown threshold
            vault.is_paused = true;
            msg!("Circuit breaker tripped: drawdown {}%", drawdown / 100);
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

        let seeds = &[
            b"buffer".as_ref(),
            vault.to_account_info().key.as_ref(),
            &[vault.buffer_bump],
        ];
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

#[derive(Accounts)]
#[instruction(buffer_bump: u8)]
pub struct Initialize<'info> {
    #[account(init, payer = owner, space = 8 + 128)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub jito_sol_mint: Account<'info, Mint>,
    #[account(
        init,
        seeds = [b"buffer", vault.key().as_ref()],
        bump = buffer_bump,
        payer = owner,
        token::mint = jito_sol_mint,
        token::authority = buffer,
    )]
    pub buffer_token: Account<'info, TokenAccount>,
    /// CHECK: PDA authority
    #[account(seeds = [b"buffer", vault.key().as_ref()], bump = buffer_bump)]
    pub buffer: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
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
pub struct DrawdownBreaker<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    /// CHECK: oracle feed (mocked by lag injector)
    pub oracle: AccountInfo<'info>,
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
    #[account(mut)]
    pub buffer_token: Account<'info, TokenAccount>,
    /// CHECK: PDA authority
    #[account(seeds = [b"buffer", vault.key().as_ref()], bump = vault.buffer_bump)]
    pub buffer: AccountInfo<'info>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub jito_sol_mint: Pubkey,
    pub buffer_bump: u8,
    pub is_paused: bool,
    pub last_price: u64,
    pub accumulated_drawdown: u64,
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
