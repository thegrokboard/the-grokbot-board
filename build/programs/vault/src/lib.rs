use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::clock::Clock;
use bytemuck::{Pod, Zeroable};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.buffer_bump = buffer_bump;
        vault.is_paused = false;
        vault.last_twap = 0;
        vault.protection_buffer = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let cpi_accounts = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.user.key(),
            &ctx.accounts.buffer.key(),
            amount,
        );
        let cpi_ctx = CpiContext::new(ctx.accounts.system_program.to_account_info(), cpi_accounts);
        anchor_lang::solana_program::program::invoke(&cpi_accounts, &[ctx.accounts.user.to_account_info(), ctx.accounts.buffer.to_account_info()])?;
        vault.protection_buffer = vault.protection_buffer.checked_add(amount).unwrap();
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let buffer = &mut ctx.accounts.buffer;
        let vault = &ctx.accounts.vault;

        require!(!vault.is_paused, ErrorCode::VaultPaused);
        require!(ctx.accounts.authority.key() == vault.owner, ErrorCode::Unauthorized);

        let seeds = &[b"buffer".as_ref(), &[buffer.bump]];
        let signer = &[&seeds[..]];

        let transfer_amount = amount.min(buffer.lamports());
        **buffer.to_account_info().try_borrow_mut_lamports()? = buffer.to_account_info().lamports().checked_sub(transfer_amount).unwrap();
        **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? = ctx.accounts.recipient.to_account_info().lamports().checked_add(transfer_amount).unwrap();

        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = false;
        Ok(())
    }

    pub fn drawdown_circuit_breaker(ctx: Context<DrawdownCircuitBreaker>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let clock = Clock::get()?;
        let current_price = get_oracle_price(&ctx.accounts.oracle)?;

        let twap = calculate_twap(vault.last_twap, current_price, clock.slot);
        vault.last_twap = twap;

        if is_drawdown(twap, current_price) {
            vault.is_paused = true;
        }
        Ok(())
    }
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub is_paused: bool,
    pub last_twap: u64,
    pub protection_buffer: u64,
    pub buffer_bump: u8,
}

#[account(zero_copy)]
#[derive(Copy, Clone, Pod, Zeroable)]
pub struct WithdrawBuffer {
    pub bump: u8,
    pub authority: Pubkey,
}

#[account]
pub struct Oracle {
    pub price: u64,
    pub slot: u64,
}

fn get_oracle_price(oracle: &Account<Oracle>) -> Result<u64> {
    Ok(oracle.price)
}

fn calculate_twap(last_twap: u64, current: u64, _slot: u64) -> u64 {
    if last_twap == 0 {
        current
    } else {
        (last_twap * 9 + current) / 10
    }
}

fn is_drawdown(twap: u64, current: u64) -> bool {
    if twap == 0 {
        false
    } else {
        current * 1000 < twap * 850
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 32 + 1 + 1 + 8 + 8 + 1)]
    pub vault: Account<'info, Vault>,
    #[account(init, payer = payer, space = 8 + 1 + 32, seeds = [b"buffer"], bump)]
    pub buffer: Account<'info, WithdrawBuffer>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub buffer: AccountInfo<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [b"buffer"], bump = buffer.bump)]
    pub buffer: Account<'info, WithdrawBuffer>,
    pub authority: Signer<'info>,
    #[account(mut)]
    pub recipient: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Unpause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct DrawdownCircuitBreaker<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub oracle: Account<'info, Oracle>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Drawdown detected")]
    Drawdown,
}
