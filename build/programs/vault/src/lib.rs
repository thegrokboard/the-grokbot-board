use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.buffer_bump = buffer_bump;
        vault.paused = false;
        vault.total_deposits = 0;
        vault.last_twap = 0;
        vault.last_update_slot = Clock::get()?.slot;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.paused, ErrorCode::VaultPaused);

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.user_token.to_account_info(),
            to: ctx.accounts.vault_token.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        let vault = &mut ctx.accounts.vault;
        vault.total_deposits = vault.total_deposits.checked_add(amount).unwrap();

        Ok(())
    }

    pub fn check_and_maybe_trigger(ctx: Context<CheckAndTrigger>) -> Result<()> {
        let clock = Clock::get()?;
        let vault = &ctx.accounts.vault;
        let buffer = &ctx.accounts.protection_buffer;

        require!(!vault.paused, ErrorCode::VaultPaused);

        // Immutable read of vault for TWAP logic
        let current_price = get_jito_price_from_oracle(&ctx.accounts.oracle)?;
        let slot_delta = clock.slot.saturating_sub(vault.last_update_slot);
        let new_twap = calculate_twap(vault.last_twap, current_price, slot_delta);

        if new_twap < 900_000_000 && buffer.lamports() > 0 {
            // Trigger drawdown protection - use separate mutable context in practice via reload or split
            // For single-instruction safety we avoid re-borrow by using a dedicated handler pattern
            msg!("Drawdown circuit breaker triggered - price depeg detected");
            return Err(ErrorCode::CircuitBreakerTriggered.into());
        }

        let vault = &mut ctx.accounts.vault;
        vault.last_twap = new_twap;
        vault.last_update_slot = clock.slot;

        Ok(())
    }

    pub fn owner_withdraw(ctx: Context<OwnerWithdraw>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, ErrorCode::Unauthorized);

        let seeds = &[b"buffer".as_ref(), &[vault.buffer_bump]];
        let signer = &[&seeds[..]];

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.vault_token.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.buffer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn toggle_pause(ctx: Context<TogglePause>) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, ErrorCode::Unauthorized);

        let vault = &mut ctx.accounts.vault;
        vault.paused = !vault.paused;
        msg!("Vault pause state toggled to: {}", vault.paused);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 128)]
    pub vault: Account<'info, VaultState>,
    #[account(seeds = [b"buffer"], bump)]
    /// CHECK: PDA for signer
    pub buffer: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
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
pub struct CheckAndTrigger<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    #[account(seeds = [b"buffer"], bump = vault.buffer_bump)]
    /// CHECK: protection buffer PDA
    pub protection_buffer: AccountInfo<'info>,
    /// CHECK: JitoSOL oracle feed (Pyth or Switchboard style)
    pub oracle: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct OwnerWithdraw<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    #[account(seeds = [b"buffer"], bump = vault.buffer_bump)]
    /// CHECK: PDA signer
    pub buffer: AccountInfo<'info>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct TogglePause<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub authority: Signer<'info>,
}

#[account]
pub struct VaultState {
    pub owner: Pubkey,
    pub buffer_bump: u8,
    pub paused: bool,
    pub total_deposits: u64,
    pub last_twap: u64,
    pub last_update_slot: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Circuit breaker triggered due to depeg")]
    CircuitBreakerTriggered,
    #[msg("Unauthorized")]
    Unauthorized,
}

fn get_jito_price_from_oracle(oracle: &AccountInfo) -> Result<u64> {
    // Stub for price extraction - in real sim this would parse Pyth/Switchboard account data
    // For test harness we assume the injected oracle account provides price in first 8 bytes
    let data = oracle.try_borrow_data()?;
    let price = u64::from_le_bytes(data[0..8].try_into().unwrap_or([0; 8]));
    Ok(price.max(1))
}

fn calculate_twap(last_twap: u64, current: u64, slot_delta: u64) -> u64 {
    if slot_delta == 0 {
        return last_twap.max(current);
    }
    // Simplified EMA-style TWAP for sim (real would be more precise)
    let weight = 100u64.saturating_sub(slot_delta.min(100));
    (last_twap * weight + current * (100 - weight)) / 100
}
