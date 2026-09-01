use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey::Pubkey;
use bytemuck::{Pod, Zeroable};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bps: u16) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.buffer_bps = buffer_bps;
        vault.is_paused = false;
        vault.last_twap = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
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
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);
        let seeds = &[b"vault".as_ref(), &[ctx.bumps.vault]];
        let signer = &[&seeds[..]];
        **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += amount;
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = false;
        Ok(())
    }

    pub fn drawdown_circuit_breaker(ctx: Context<DrawdownCircuitBreaker>, current_price: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let twap = ctx.accounts.twap_account.twap;

        if current_price < twap * (10000 - vault.buffer_bps as u64) / 10000 {
            vault.is_paused = true;
        }
        vault.last_twap = twap;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 8 + 32 + 2 + 1 + 8, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction()]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Unpause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct DrawdownCircuitBreaker<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub twap_account: Account<'info, TwapAccount>,
    pub owner: Signer<'info>,
}

#[account]
#[derive(Default)]
pub struct Vault {
    pub owner: Pubkey,
    pub buffer_bps: u16,
    pub is_paused: bool,
    pub last_twap: u64,
}

#[account]
#[derive(Default)]
pub struct TwapAccount {
    pub twap: u64,
    pub last_update_slot: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Drawdown detected")]
    DrawdownDetected,
}

#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct PriceData {
    pub price: u64,
    pub slot: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vault() {
        let vault = Vault::default();
        assert_eq!(vault.buffer_bps, 0);
    }
}
