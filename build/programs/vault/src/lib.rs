use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::clock::Clock;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

declare_id!("Vault1111111111111111111111111111111111111111");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
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

        // Record deposit into buffer
        let buffer = &mut ctx.accounts.buffer;
        buffer.jitosol_balance = buffer.jitosol_balance.checked_add(amount).unwrap();

        Ok(())
    }

    pub fn check_and_trigger_breaker(ctx: Context<CheckBreaker>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        let clock = Clock::get()?;
        let current_slot = clock.slot;

        // Load Switchboard V2 price (simulating JitoSOL / SOL price feed)
        let price_feed = &ctx.accounts.price_feed;
        let price = load_price_from_account(price_feed)?;

        let twap = calculate_15s_twap(price, current_slot, vault.last_twap, vault.last_twap_slot)?;

        let drawdown = if vault.last_twap > 0 {
            ((vault.last_twap as i128 - twap as i128) * 10000) / vault.last_twap as i128
        } else {
            0
        };

        // 5% drawdown threshold triggers breaker
        if drawdown > 500 {
            vault.is_paused = true;
            emit!(CircuitBreakerTriggered {
                drawdown: drawdown as u64,
                slot: current_slot,
            });
        } else {
            vault.last_twap = twap;
            vault.last_twap_slot = current_slot;
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

        let buffer = &mut ctx.accounts.buffer;

        require!(amount <= buffer.jitosol_balance, ErrorCode::InsufficientBalance);

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

        buffer.jitosol_balance = buffer.jitosol_balance.checked_sub(amount).unwrap();

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(owner: Pubkey, buffer_bump: u8)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 8 + 32 + 1 + 1 + 8 + 8)]
    pub vault: Account<'info, VaultState>,
    #[account(
        init,
        payer = payer,
        seeds = [b"buffer"],
        bump = buffer_bump,
        space = 8 + 8
    )]
    pub buffer: Account<'info, ProtectionBuffer>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub jito_mint: Account<'info, Mint>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub buffer: Account<'info, ProtectionBuffer>,
    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CheckBreaker<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    /// Switchboard V2 price account for JitoSOL
    pub price_feed: AccountInfo<'info>,
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
    pub buffer: Account<'info, ProtectionBuffer>,
    #[account(mut)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct VaultState {
    pub owner: Pubkey,
    pub buffer_bump: u8,
    pub is_paused: bool,
    pub last_twap: u64,
    pub last_twap_slot: u64,
}

#[account]
pub struct ProtectionBuffer {
    pub jitosol_balance: u64,
}

#[event]
pub struct CircuitBreakerTriggered {
    pub drawdown: u64,
    pub slot: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault is not paused")]
    NotPaused,
    #[msg("Insufficient balance in buffer")]
    InsufficientBalance,
    #[msg("Oracle price is stale")]
    StaleOracle,
    #[msg("Invalid oracle data")]
    InvalidOracleData,
}

// Switchboard V2 oracle loader (matches the previous CI fix)
pub fn load_price_from_account(price_feed: &AccountInfo) -> Result<u64> {
    let data = price_feed.try_borrow_data()?;
    // Minimal Switchboard V2 aggregator parsing for sim (latest_confirmed round value)
    // In real usage this would use switchboard crate; here we extract u64 at offset for test compat
    if data.len() < 200 {
        return Err(ErrorCode::InvalidOracleData.into());
    }
    let price: u64 = u64::from_le_bytes([
        data[136], data[137], data[138], data[139],
        data[140], data[141], data[142], data[143],
    ]);
    if price == 0 {
        return Err(ErrorCode::InvalidOracleData.into());
    }
    Ok(price)
}

// Simple 15-second TWAP calculator (assumes ~0.4s per slot; target 15s = ~37 slots)
fn calculate_15s_twap(current_price: u64, current_slot: u64, last_twap: u64, last_slot: u64) -> Result<u64> {
    if last_slot == 0 || current_slot <= last_slot {
        return Ok(current_price);
    }

    let slots_delta = current_slot - last_slot;
    if slots_delta > 100 { // too stale
        return Err(ErrorCode::StaleOracle.into());
    }

    // Exponential moving average approximation for TWAP
    let alpha = if slots_delta > 37 { 1000u64 } else { (slots_delta * 1000) / 37 };
    let new_twap = ((last_twap as u128 * (1000 - alpha) as u128 + current_price as u128 * alpha as u128) / 1000) as u64;
    Ok(new_twap)
}
