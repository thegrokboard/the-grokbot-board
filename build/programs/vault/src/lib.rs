use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, protection_buffer_bps: u16) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.jito_sol_mint = ctx.accounts.jito_sol_mint.key();
        vault.protection_buffer_bps = protection_buffer_bps;
        vault.is_paused = false;
        vault.last_twap = 0;
        vault.buffer_account = ctx.accounts.buffer.key();
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.user_jito_sol.to_account_info(),
            to: ctx.accounts.vault_jito_sol.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn drawdown_circuit_breaker(ctx: Context<DrawdownCircuitBreaker>) -> Result<()> {
        let oracle_price = get_oracle_price(&ctx.accounts.oracle)?;
        let vault = &mut ctx.accounts.vault;

        // Simple 15s TWAP simulation check (real impl would use onchain TWAP account)
        let current_price = oracle_price;
        let twap = if vault.last_twap == 0 {
            current_price
        } else {
            (vault.last_twap * 2 + current_price) / 3 // naive EMA
        };
        vault.last_twap = twap;

        let depeg_threshold = 9500u64; // 5% depeg
        if twap < (current_price * depeg_threshold / 10000) {
            vault.is_paused = true;
            msg!("Circuit breaker tripped: depeg detected");
        }

        Ok(())
    }

    pub fn owner_pause(ctx: Context<OwnerPause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn owner_withdraw(ctx: Context<OwnerWithdraw>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        require!(vault.is_paused, ErrorCode::NotPaused);

        let seeds = &[b"vault".as_ref(), &[ctx.bumps.vault]];
        let signer = &[&seeds[..]];

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.vault_jito_sol.to_account_info(),
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
#[instruction(owner: Pubkey)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 8 + 32 + 32 + 2 + 1 + 8 + 32, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    pub jito_sol_mint: Account<'info, Mint>,
    #[account(mut)]
    pub buffer: Account<'info, TokenAccount>,
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
    pub user_jito_sol: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_jito_sol: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct DrawdownCircuitBreaker<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    /// CHECK: Switchboard V2 aggregator oracle (price data parsed manually)
    #[account()]
    pub oracle: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct OwnerPause<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct OwnerWithdraw<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub vault_jito_sol: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct VaultState {
    pub owner: Pubkey,
    pub jito_sol_mint: Pubkey,
    pub protection_buffer_bps: u16,
    pub is_paused: bool,
    pub last_twap: u64,
    pub buffer_account: Pubkey,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Vault must be paused for withdraw")]
    NotPaused,
    #[msg("Oracle parse error")]
    OracleError,
}

fn get_oracle_price(oracle: &AccountInfo) -> Result<u64> {
    // Switchboard V2 Aggregator minimal parse (price in the first 8 bytes after header for sim)
    // Real production would use switchboard crate; here we simulate for test-validator harness
    let data = oracle.try_borrow_data().map_err(|_| error!(ErrorCode::OracleError))?;
    if data.len() < 16 {
        return Err(error!(ErrorCode::OracleError));
    }
    // Mock price feed: read u64 at offset 8 (simulates JitoSOL price in USD * 1e6)
    let price = u64::from_le_bytes([
        data[8], data[9], data[10], data[11],
        data[12], data[13], data[14], data[15],
    ]);
    if price == 0 {
        return Err(error!(ErrorCode::OracleError));
    }
    Ok(price)
}
