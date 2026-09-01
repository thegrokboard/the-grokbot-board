use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

declare_id!("Vau1tX1f8v7v7v7v7v7v7v7v7v7v7v7v7v7v7v7");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bps: u16) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.buffer_bps = buffer_bps;
        vault.is_paused = false;
        vault.jito_sol_mint = ctx.accounts.jito_sol_mint.key();
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, VaultError::VaultPaused);

        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.user_token.to_account_info(),
                to: ctx.accounts.vault_token.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn drawdown_check(ctx: Context<DrawdownCheck>) -> Result<()> {
        let vault = &ctx.accounts.vault;
        let clock = Clock::get()?;
        let price = ctx.accounts.oracle.load()?.get_price(&clock)?;

        let twap = ctx.accounts.twap_account.load()?.compute_twap(price, &clock)?;
        let drawdown = if twap > 0 {
            ((price as i128 * 10000) / twap as i128) as u16
        } else {
            0
        };

        let buffer_bps = vault.buffer_bps as u16;
        if drawdown < buffer_bps {
            return Err(VaultError::DrawdownBelowBuffer.into());
        }

        // Trip breaker on severe drawdown
        if drawdown > 9500 {  // 5% remaining = 95% drawdown
            let breaker = &mut ctx.accounts.breaker;
            breaker.tripped = true;
            breaker.trip_slot = clock.slot;
            breaker.trip_price = price;
        }

        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, VaultError::Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, VaultError::Unauthorized);
        vault.is_paused = false;
        Ok(())
    }

    pub fn owner_withdraw(ctx: Context<OwnerWithdraw>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, VaultError::Unauthorized);
        require!(vault.is_paused, VaultError::VaultNotPaused);

        let seeds = &[b"vault".as_ref(), &[ctx.bumps.vault]];
        let signer = &[&seeds[..]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.vault_token.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer,
        );
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 8 + 32 + 2 + 1 + 32, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    pub jito_sol_mint: Account<'info, Mint>,
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
    pub user_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"vault_token", vault.key().as_ref()], bump)]
    pub vault_token: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct DrawdownCheck<'info> {
    #[account(seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    #[account(mut, seeds = [b"breaker"], bump)]
    pub breaker: Account<'info, BreakerState>,
    /// CHECK: oracle PDA validated in oracle-utils
    pub oracle: UncheckedAccount<'info>,
    /// CHECK: twap account
    pub twap_account: UncheckedAccount<'info>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct OwnerWithdraw<'info> {
    #[account(seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    #[account(mut, seeds = [b"vault_token", vault.key().as_ref()], bump)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(Default)]
pub struct VaultState {
    pub owner: Pubkey,
    pub buffer_bps: u16,
    pub is_paused: bool,
    pub jito_sol_mint: Pubkey,
}

#[account]
#[derive(Default)]
pub struct BreakerState {
    pub tripped: bool,
    pub trip_slot: u64,
    pub trip_price: u64,
}

#[error_code]
pub enum VaultError {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Drawdown below protection buffer")]
    DrawdownBelowBuffer,
    #[msg("Vault must be paused for owner withdraw")]
    VaultNotPaused,
}

// Stub oracle price loader – real impl expected to be provided by oracle-utils in sim
pub trait PriceOracle {
    fn get_price(&self, clock: &Clock) -> Result<u64>;
}

impl PriceOracle for OracleAccount {
    fn get_price(&self, _clock: &Clock) -> Result<u64> {
        // In real sim this is replaced by injected lagged price
        Ok(950_000_000) // placeholder ~0.95 SOL
    }
}

#[account]
pub struct OracleAccount {
    pub price: u64,
    pub last_update_slot: u64,
}

#[account]
pub struct TwapAccount {
    pub prices: [u64; 32],
    pub slots: [u64; 32],
    pub head: u8,
}

impl TwapAccount {
    pub fn compute_twap(&self, current_price: u64, clock: &Clock) -> Result<u64> {
        let mut sum = current_price as u128;
        let mut count = 1u128;
        for i in 0..32 {
            if self.slots[i] > 0 && clock.slot - self.slots[i] < 7 * 24 * 3600 {
                sum += self.prices[i] as u128;
                count += 1;
            }
        }
        Ok((sum / count) as u64)
    }
}
