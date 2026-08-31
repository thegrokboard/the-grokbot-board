use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::clock::Clock;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = *ctx.accounts.owner.key;
        vault.jito_sol_mint = *ctx.accounts.jito_sol_mint.key;
        vault.protection_buffer = *ctx.accounts.protection_buffer.key;
        vault.is_paused = false;
        vault.last_twap = 0;
        vault.drawdown_threshold = 500; // 5% in basis points
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);
        // In real impl this would CPI to token program; here we just record for sim
        Ok(())
    }

    pub fn report_twap(ctx: Context<ReportTwap>, twap: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);
        vault.last_twap = twap;
        Ok(())
    }

    pub fn check_drawdown(ctx: Context<CheckDrawdown>) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        let clock = Clock::get()?;
        let current_price = get_oracle_price(&ctx.accounts.oracle)?; // stubbed for sim

        let drawdown = if vault.last_twap > current_price {
            ((vault.last_twap - current_price) * 10000) / vault.last_twap
        } else {
            0
        };

        if drawdown > vault.drawdown_threshold {
            return Err(ErrorCode::DrawdownBreached.into());
        }
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
        require!(vault.is_paused, ErrorCode::NotPaused);
        // Real impl would transfer from buffer; sim only checks auth
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = owner, space = 8 + 8 + 32 + 32 + 32 + 1 + 8 + 8)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub jito_sol_mint: AccountInfo<'info>,
    pub protection_buffer: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub user: Signer<'info>,
    // token accounts omitted for minimal sim harness
}

#[derive(Accounts)]
pub struct ReportTwap<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub oracle: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CheckDrawdown<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub oracle: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawBuffer<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
    // buffer token account omitted for sim
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub jito_sol_mint: Pubkey,
    pub protection_buffer: Pubkey,
    pub is_paused: bool,
    pub last_twap: u64,
    pub drawdown_threshold: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Drawdown circuit breaker breached")]
    DrawdownBreached,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault must be paused to withdraw")]
    NotPaused,
}

fn get_oracle_price(_oracle: &AccountInfo) -> Result<u64> {
    // For simulation harness - real implementation would parse Switchboard or Pyth account
    Ok(950_000_000) // placeholder price
}
