use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        state.owner = ctx.accounts.owner.key();
        state.buffer_lamports = 0;
        state.is_paused = false;
        state.last_twap = 0;
        state.drawdown_threshold = 500; // 5% in basis points
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        require!(!state.is_paused, VaultError::VaultPaused);

        // In a real vault this would CPI to Jito or token program; here we just record
        state.buffer_lamports = state.buffer_lamports.saturating_add(amount);
        Ok(())
    }

    pub fn update_price(ctx: Context<UpdatePrice>) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        let price_account = &ctx.accounts.price_account;

        require!(!state.is_paused, VaultError::VaultPaused);

        let current_price = price_account.price;
        // Simple TWAP stub for sim: in reality would use 15s window over oracle history
        state.last_twap = current_price;

        Ok(())
    }

    pub fn check_drawdown(ctx: Context<CheckDrawdown>) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        let price_account = &ctx.accounts.price_account;

        require!(!state.is_paused, VaultError::VaultPaused);

        let current_price = price_account.price;
        let twap = state.last_twap;

        if twap == 0 {
            return Ok(());
        }

        let drawdown_bps = if current_price < twap {
            ((twap - current_price) * 10000) / twap
        } else {
            0
        };

        if drawdown_bps > state.drawdown_threshold {
            state.is_paused = true;
            msg!("Circuit breaker tripped! Drawdown: {} bps", drawdown_bps);
        }

        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        require!(ctx.accounts.owner.key() == state.owner, VaultError::Unauthorized);
        state.is_paused = true;
        msg!("Vault paused by owner");
        Ok(())
    }

    pub fn withdraw_buffer(ctx: Context<WithdrawBuffer>, amount: u64) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        require!(ctx.accounts.owner.key() == state.owner, VaultError::Unauthorized);
        require!(state.buffer_lamports >= amount, VaultError::InsufficientBuffer);

        state.buffer_lamports = state.buffer_lamports.saturating_sub(amount);

        let from = ctx.accounts.buffer_account.to_account_info();
        let to = ctx.accounts.owner.to_account_info();
        let seeds = &[b"buffer".as_ref(), &[ctx.bumps.buffer_account]];
        let signer = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: from.clone(),
                to: to.clone(),
            },
            signer,
        );
        anchor_lang::system_program::transfer(transfer_ctx, amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = owner, space = 8 + 8 + 32 + 1 + 8 + 8, seeds = [b"vault"], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut)]
    pub buffer_account: AccountInfo<'info>, // in real impl this would be a token account
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdatePrice<'info> {
    #[account(mut)]
    pub vault_state: Account<'info, VaultState>,
    #[account()]
    pub price_account: Account<'info, PriceAccount>,
}

#[derive(Accounts)]
pub struct CheckDrawdown<'info> {
    #[account(mut)]
    pub vault_state: Account<'info, VaultState>,
    #[account()]
    pub price_account: Account<'info, PriceAccount>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub vault_state: Account<'info, VaultState>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawBuffer<'info> {
    #[account(mut)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut, seeds = [b"buffer"], bump)]
    pub buffer_account: SystemAccount<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(Default)]
pub struct VaultState {
    pub owner: Pubkey,
    pub buffer_lamports: u64,
    pub is_paused: bool,
    pub last_twap: u64,
    pub drawdown_threshold: u64,
}

#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct PriceAccount {
    pub price: u64,
    pub slot: u64,
    pub _padding: [u8; 16],
}

impl anchor_lang::Owner for PriceAccount {
    fn owner() -> Pubkey {
        // Use the Switchboard oracle program ID for the sim (common for Jito price feeds)
        Pubkey::from_str_const("SW1TCH7qEPTdLsDHRgXhFzQH9f4Vv4q2vA5tVv9cF5J")
    }
}

// Anchor requires these for custom non-#[account] types used in Account<'info, T>
impl anchor_lang::AccountSerialize for PriceAccount {}
impl anchor_lang::AccountDeserialize for PriceAccount {}

#[error_code]
pub enum VaultError {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Insufficient buffer")]
    InsufficientBuffer,
}
