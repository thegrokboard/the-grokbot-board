use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.jito_mint = ctx.accounts.jito_mint.key();
        vault.buffer_bump = buffer_bump;
        vault.paused = false;
        vault.last_twap = 0;
        vault.last_twap_slot = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.paused, ErrorCode::VaultPaused);

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

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        vault.paused = true;
        Ok(())
    }

    pub fn resume(ctx: Context<Resume>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        vault.paused = false;
        Ok(())
    }

    pub fn trigger_drawdown(ctx: Context<TriggerDrawdown>) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.paused, ErrorCode::VaultPaused);

        let clock = Clock::get()?;
        let current_slot = clock.slot;

        // Simple drawdown circuit breaker: if price depegged below 0.9 for sustained period
        // (simulated via oracle lag + TWAP check in harness)
        let depeg_threshold = 900_000_000u64; // 0.9 * 1e9
        if ctx.accounts.oracle_price.price < depeg_threshold {
            // In real use this would transfer out to protection buffer; here we just emit event
            emit!(DrawdownTriggered {
                slot: current_slot,
                price: ctx.accounts.oracle_price.price,
            });
        }

        Ok(())
    }

    pub fn emergency_withdraw(ctx: Context<EmergencyWithdraw>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        require!(vault.paused, ErrorCode::NotPaused);

        let seeds = &[
            b"vault".as_ref(),
            &[vault.buffer_bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
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
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 32 + 1 + 1 + 8 + 8,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Account<'info, Vault>,

    pub jito_mint: Account<'info, Mint>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        seeds = [b"vault"],
        bump = vault.buffer_bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = vault.jito_mint,
        associated_token::authority = vault
    )]
    pub vault_token: Account<'info, TokenAccount>,

    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut, seeds = [b"vault"], bump = vault.buffer_bump)]
    pub vault: Account<'info, Vault>,

    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Resume<'info> {
    #[account(mut, seeds = [b"vault"], bump = vault.buffer_bump)]
    pub vault: Account<'info, Vault>,

    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct TriggerDrawdown<'info> {
    #[account(seeds = [b"vault"], bump = vault.buffer_bump)]
    pub vault: Account<'info, Vault>,

    /// Simulated oracle account passed from lag injector (Switchboard or custom)
    pub oracle_price: Account<'info, OraclePrice>,
}

#[derive(Accounts)]
pub struct EmergencyWithdraw<'info> {
    #[account(seeds = [b"vault"], bump = vault.buffer_bump)]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub vault_token: Account<'info, TokenAccount>,

    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,

    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub jito_mint: Pubkey,
    pub buffer_bump: u8,
    pub paused: bool,
    pub last_twap: u64,
    pub last_twap_slot: u64,
}

#[account]
pub struct OraclePrice {
    pub price: u64,
    pub slot: u64,
}

#[event]
pub struct DrawdownTriggered {
    pub slot: u64,
    pub price: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault must be paused for emergency withdraw")]
    NotPaused,
}
