use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey::Pubkey;
use bytemuck::{Pod, Zeroable};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg4t5n1v7nA");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bump: u8) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        state.owner = owner;
        state.buffer_bump = buffer_bump;
        state.is_paused = false;
        state.last_twap = 0;
        state.last_update_slot = 0;
        Ok(())
    }

    pub fn deposit_jitosol(ctx: Context<DepositJitoSol>, amount: u64) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        if state.is_paused {
            return Err(error!(ErrorCode::VaultPaused));
        }
        // In a real vault this would CPI to the Jito stake pool.
        // For the sim we simply record the deposit.
        state.total_assets = state.total_assets.saturating_add(amount);
        Ok(())
    }

    pub fn update_twap(ctx: Context<UpdateTwap>, new_twap: u64, current_slot: u64) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        if state.is_paused {
            return Err(error!(ErrorCode::VaultPaused));
        }
        state.last_twap = new_twap;
        state.last_update_slot = current_slot;
        Ok(())
    }

    pub fn drawdown_circuit_breaker(ctx: Context<DrawdownCircuitBreaker>) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        let price_account = &ctx.accounts.price_account;

        // Simple depeg detection for the sim: if price < 0.95 * 1e9 we trip.
        if price_account.price < 950_000_000 {
            state.is_paused = true;
        }
        Ok(())
    }

    pub fn owner_pause(ctx: Context<OwnerPause>) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        require!(ctx.accounts.owner.key() == state.owner, ErrorCode::Unauthorized);
        state.is_paused = true;
        Ok(())
    }

    pub fn owner_withdraw(ctx: Context<OwnerWithdraw>, amount: u64) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        require!(ctx.accounts.owner.key() == state.owner, ErrorCode::Unauthorized);
        require!(state.is_paused, ErrorCode::NotPaused);

        let vault_lamports = ctx.accounts.vault_state.to_account_info().lamports();
        require!(*vault_lamports >= amount, ErrorCode::InsufficientFunds);

        **ctx.accounts.vault_state.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.recipient.try_borrow_mut_lamports()? += amount;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 8 + 32 + 1 + 8 + 8)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositJitoSol<'info> {
    #[account(mut)]
    pub vault_state: Account<'info, VaultState>,
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateTwap<'info> {
    #[account(mut)]
    pub vault_state: Account<'info, VaultState>,
    pub oracle: Signer<'info>,
}

#[derive(Accounts)]
pub struct DrawdownCircuitBreaker<'info> {
    #[account(mut)]
    pub vault_state: Account<'info, VaultState>,
    pub price_account: Account<'info, PriceAccount>,
}

#[derive(Accounts)]
pub struct OwnerPause<'info> {
    #[account(mut)]
    pub vault_state: Account<'info, VaultState>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct OwnerWithdraw<'info> {
    #[account(mut)]
    pub vault_state: Account<'info, VaultState>,
    pub owner: Signer<'info>,
    /// CHECK: recipient of withdrawn funds
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
}

#[account]
#[derive(Default)]
pub struct VaultState {
    pub owner: Pubkey,
    pub is_paused: bool,
    pub buffer_bump: u8,
    pub total_assets: u64,
    pub last_twap: u64,
    pub last_update_slot: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct PriceAccount {
    pub price: u64,
    pub slot: u64,
    pub _padding: [u8; 16],
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Must be paused to withdraw")]
    NotPaused,
    #[msg("Insufficient funds")]
    InsufficientFunds,
}
