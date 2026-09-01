use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};
use std::mem::size_of;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = ctx.accounts.owner.key();
        vault.jito_sol_mint = ctx.accounts.jito_sol_mint.key();
        vault.protection_buffer = ctx.accounts.protection_buffer.key();
        vault.paused = false;
        vault.drawdown_threshold = 500; // 5% example
        vault.bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, _amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.paused, ErrorCode::Paused);

        // In a real program this would CPI to the JitoSOL token program
        // For sim we just record
        Ok(())
    }

    pub fn drawdown_circuit_breaker(ctx: Context<DrawdownCircuitBreaker>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let _clock = Clock::get()?;
        let current_price = get_oracle_price(&ctx.accounts.price_account)?;

        let twap = calculate_twap(&ctx.accounts.price_history)?;

        let drawdown = if twap > 0 {
            ((twap as i128 - current_price as i128).abs() * 10000 / twap as i128) as u64
        } else {
            0
        };

        if drawdown > vault.drawdown_threshold {
            vault.paused = true;
            msg!("Circuit breaker tripped! Drawdown: {}", drawdown);
        }

        Ok(())
    }

    pub fn owner_pause(ctx: Context<OwnerPause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        vault.paused = true;
        Ok(())
    }

    pub fn owner_withdraw(ctx: Context<OwnerWithdraw>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        require!(vault.paused, ErrorCode::NotPaused);

        // In real implementation this would transfer from protection_buffer
        msg!("Withdrew {} from protection buffer", amount);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + size_of::<VaultState>(),
        seeds = [b"vault"],
        bump,
    )]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: mint address recorded only, no data read
    pub jito_sol_mint: AccountInfo<'info>,
    /// CHECK: buffer address recorded only, no data read
    #[account(mut)]
    pub protection_buffer: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub depositor: Signer<'info>,
    // additional token accounts omitted for sim
}

#[derive(Accounts)]
pub struct DrawdownCircuitBreaker<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    /// CHECK: oracle price account, validated by deserialization length check
    pub price_account: AccountInfo<'info>,
    /// CHECK: price history account, validated by deserialization length check
    pub price_history: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct OwnerPause<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct OwnerWithdraw<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub owner: Signer<'info>,
    // protection buffer token account etc.
}

#[account]
pub struct VaultState {
    pub owner: Pubkey,
    pub jito_sol_mint: Pubkey,
    pub protection_buffer: Pubkey,
    pub paused: bool,
    pub drawdown_threshold: u64,
    pub bump: u8,
    pub last_twap_slot: u64,
    pub buffer: [u8; 64], // padding
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    Paused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault is not paused")]
    NotPaused,
    #[msg("Invalid oracle account")]
    InvalidOracle,
    #[msg("Insufficient protection buffer")]
    InsufficientBuffer,
}

fn get_oracle_price(account: &AccountInfo) -> Result<u64> {
    // Stub for sim: read last price from account data
    let data = account.try_borrow_data()?;
    if data.len() < 16 {
        return err!(ErrorCode::InvalidOracle);
    }
    let price = u64::from_le_bytes(data[0..8].try_into().unwrap());
    Ok(price)
}

fn calculate_twap(history_account: &AccountInfo) -> Result<u64> {
    // Stub for 15s TWAP checker integration
    let data = history_account.try_borrow_data()?;
    if data.len() < 8 {
        return Ok(1000u64); // placeholder
    }
    Ok(u64::from_le_bytes(data[0..8].try_into().unwrap()))
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct PriceData {
    pub price: u64,
    pub slot: u64,
    pub _padding: [u8; 16],
}
