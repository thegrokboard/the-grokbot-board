use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenAccount, TokenInterface};

declare_id!("Vault1111111111111111111111111111111111111111");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bps: u16) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.jito_sol_mint = ctx.accounts.jito_sol_mint.key();
        vault.buffer_bps = buffer_bps;
        vault.is_paused = false;
        vault.last_twap = 0;
        vault.drawdown_threshold = 500; // 5% example
        Ok(())
    }

    pub fn update_twap(ctx: Context<UpdateTwap>, new_twap: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, VaultError::VaultPaused);
        vault.last_twap = new_twap;
        Ok(())
    }

    pub fn drawdown_breaker(ctx: Context<DrawdownBreaker>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, VaultError::VaultPaused);
        // Simple circuit breaker logic (real impl would compare TWAP vs oracle)
        vault.is_paused = true;
        msg!("Drawdown circuit breaker tripped - vault paused");
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, VaultError::Unauthorized);
        vault.is_paused = true;
        msg!("Vault paused by owner");
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, VaultError::Unauthorized);
        require!(vault.is_paused, VaultError::NotPaused);
        
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.buffer.to_account_info(),
                to: ctx.accounts.withdraw_to.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.jito_sol_mint.to_account_info(),
            },
        );
        anchor_spl::token_interface::transfer_checked(transfer_ctx, amount, 9)?;
        
        msg!("Emergency withdraw completed");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 8 + 32 + 32 + 2 + 1 + 8 + 2)]
    pub vault: Account<'info, VaultState>,
    pub jito_sol_mint: InterfaceAccount<'info, anchor_spl::token_interface::Mint>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct UpdateTwap<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub oracle: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct DrawdownBreaker<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub oracle: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub buffer: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub withdraw_to: InterfaceAccount<'info, TokenAccount>,
    pub jito_sol_mint: InterfaceAccount<'info, anchor_spl::token_interface::Mint>,
    pub owner: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[account]
pub struct VaultState {
    pub owner: Pubkey,
    pub jito_sol_mint: Pubkey,
    pub buffer_bps: u16,
    pub is_paused: bool,
    pub last_twap: u64,
    pub drawdown_threshold: u16,
}

#[error_code]
pub enum VaultError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Vault is not paused")]
    NotPaused,
    #[msg("Drawdown threshold exceeded")]
    DrawdownExceeded,
}
