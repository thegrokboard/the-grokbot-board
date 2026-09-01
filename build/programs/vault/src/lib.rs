use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

declare_id!("Vau1t1111111111111111111111111111111111111");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, protection_buffer_bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.protection_buffer_bump = protection_buffer_bump;
        vault.is_paused = false;
        vault.last_twap = 0;
        vault.drawdown_threshold = 150; // 15.0% in basis points * 10
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        // In real impl this would CPI to jito-stake-pool or similar; stub for sim
        Ok(())
    }

    pub fn update_twap(ctx: Context<UpdateTwap>, new_twap: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);
        vault.last_twap = new_twap;
        Ok(())
    }

    pub fn check_drawdown(ctx: Context<CheckDrawdown>, current_price: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        if vault.last_twap == 0 {
            return Ok(());
        }

        let threshold = vault.drawdown_threshold as u64;
        let max_drawdown = (vault.last_twap * threshold) / 1000;

        if current_price < max_drawdown {
            vault.is_paused = true;
            msg!("Drawdown circuit breaker tripped!");
        }
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn withdraw_buffer(ctx: Context<WithdrawBuffer>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, ErrorCode::Unauthorized);
        require!(vault.is_paused, ErrorCode::NotPaused);
        // In sim we just log; real impl would transfer from buffer PDA
        msg!("Withdrew {} from protection buffer", amount);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 128, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateTwap<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    // Oracle account would be here in full impl
}

#[derive(Accounts)]
pub struct CheckDrawdown<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawBuffer<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub authority: Signer<'info>,
    // Buffer PDA would be here
}

#[account]
#[derive(Default)]
pub struct VaultState {
    pub owner: Pubkey,
    pub is_paused: bool,
    pub last_twap: u64,
    pub drawdown_threshold: u16,
    pub protection_buffer_bump: u8,
    pub _padding: [u8; 7], // explicit padding to avoid derive(Pod) issues on larger structs
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault must be paused to withdraw")]
    NotPaused,
}
