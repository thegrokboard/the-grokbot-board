use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::clock::Clock;
use bytemuck::{Pod, Zeroable};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = *ctx.accounts.owner.key;
        vault.is_paused = false;
        vault.jito_sol_mint = ctx.accounts.jito_sol_mint.key();
        vault.protection_buffer = ctx.accounts.protection_buffer.key();
        vault.last_twap = 0;
        vault.drawdown_threshold = 500; // 5% in basis points
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, VaultError::VaultPaused);

        let cpi_accounts = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.user.key(),
            &ctx.accounts.vault.key(),
            amount,
        );
        anchor_lang::solana_program::program::invoke(
            &cpi_accounts,
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.vault.to_account_info(),
            ],
        )?;

        // In real implementation this would handle jitoSOL SPL transfer
        // For sim we accept native for buffer top-up
        Ok(())
    }

    pub fn owner_pause(ctx: Context<OwnerPause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, VaultError::Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn owner_withdraw(ctx: Context<OwnerWithdraw>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.signer.key() == vault.owner, VaultError::Unauthorized);
        require!(vault.is_paused, VaultError::VaultNotPaused);

        **ctx.accounts.vault.lamports.borrow_mut() -= amount;
        **ctx.accounts.destination.lamports.borrow_mut() += amount;

        Ok(())
    }

    pub fn check_drawdown(ctx: Context<CheckDrawdown>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let clock = Clock::get()?;

        // Simplified TWAP check using oracle price feed (in sim this is updated by lag injector)
        let current_price = ctx.accounts.oracle_price.get_price();
        let twap = vault.last_twap;

        let drawdown_bps = if current_price < twap {
            ((twap - current_price) * 10000) / twap
        } else {
            0
        };

        if drawdown_bps > vault.drawdown_threshold {
            vault.is_paused = true;
            msg!("Drawdown circuit breaker tripped! Drawdown: {} bps", drawdown_bps);
        }

        // Update last TWAP (in real this would be proper 15s TWAP calculation)
        vault.last_twap = current_price;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = owner, space = 8 + 128, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub jito_sol_mint: AccountInfo<'info>,
    #[account(seeds = [b"protection_buffer", vault.key().as_ref()], bump)]
    pub protection_buffer: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
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
    #[account(mut)]
    pub destination: SystemAccount<'info>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct CheckDrawdown<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub oracle_price: Account<'info, PriceAccount>,
}

#[account]
#[derive(Default)]
pub struct VaultState {
    pub owner: Pubkey,
    pub is_paused: bool,
    pub jito_sol_mint: Pubkey,
    pub protection_buffer: Pubkey,
    pub last_twap: u64,
    pub drawdown_threshold: u64,
}

#[account]
#[derive(Copy, Clone, Pod, Zeroable)]
#[repr(C)]
pub struct PriceAccount {
    pub price: u64,
    pub slot: u64,
    pub _padding: [u8; 16],
}

impl PriceAccount {
    pub fn get_price(&self) -> u64 {
        self.price
    }
}

#[error_code]
pub enum VaultError {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Vault is not paused")]
    VaultNotPaused,
    #[msg("Unauthorized")]
    Unauthorized,
}
