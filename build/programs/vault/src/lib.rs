use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};
use bytemuck::{Pod, Zeroable};

declare_id!("Vau1tX2r9JqQ7vL7zqK7zqK7zqK7zqK7zqK7zqK7zq");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bps: u16, drawdown_threshold: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.buffer_bps = buffer_bps;
        vault.drawdown_threshold = drawdown_threshold;
        vault.paused = false;
        vault.total_deposited = 0;
        vault.last_twap = 0;
        vault.last_update_slot = Clock::get()?.slot;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.paused, ErrorCode::VaultPaused);

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.user_token.to_account_info(),
            to: ctx.accounts.vault_token.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        vault.total_deposited = vault.total_deposited.checked_add(amount).unwrap();
        Ok(())
    }

    pub fn update_twap(ctx: Context<UpdateTwap>, new_twap: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let clock = Clock::get()?;
        require!(!vault.paused, ErrorCode::VaultPaused);

        let slot_diff = clock.slot.saturating_sub(vault.last_update_slot);
        if slot_diff > 0 {
            vault.last_twap = new_twap;
            vault.last_update_slot = clock.slot;
        }

        let protection_buffer = &mut ctx.accounts.protection_buffer;
        let buffer_amount = (vault.total_deposited as u128 * vault.buffer_bps as u128 / 10000) as u64;
        
        if protection_buffer.lamports() < buffer_amount as u64 {
            return Err(ErrorCode::InsufficientBuffer.into());
        }

        let drawdown = if new_twap < vault.last_twap {
            vault.last_twap.saturating_sub(new_twap)
        } else {
            0
        };

        if drawdown > vault.drawdown_threshold {
            vault.paused = true;
            msg!("Circuit breaker tripped! Drawdown: {}", drawdown);
        }

        Ok(())
    }

    pub fn pause(ctx: Context<OwnerAction>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        vault.paused = true;
        Ok(())
    }

    pub fn resume(ctx: Context<OwnerAction>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        vault.paused = false;
        Ok(())
    }

    pub fn withdraw_buffer(ctx: Context<WithdrawBuffer>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, ErrorCode::Unauthorized);
        require!(vault.paused, ErrorCode::VaultNotPaused);

        let buffer = &ctx.accounts.protection_buffer;
        let seeds = &[b"buffer".as_ref(), &[ctx.bumps.protection_buffer]];
        let signer = &[&seeds[..]];

        let cpi_accounts = token::Transfer {
            from: buffer.to_account_info(),
            to: ctx.accounts.owner_token.to_account_info(),
            authority: buffer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 128)]
    pub vault: Account<'info, Vault>,
    #[account(init, payer = payer, space = 8 + std::mem::size_of::<ProtectionBuffer>(), seeds = [b"buffer"], bump)]
    pub protection_buffer: Account<'info, ProtectionBuffer>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateTwap<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [b"buffer"], bump)]
    pub protection_buffer: Account<'info, ProtectionBuffer>,
}

#[derive(Accounts)]
pub struct OwnerAction<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawBuffer<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [b"buffer"], bump)]
    pub protection_buffer: Account<'info, TokenAccount>,
    #[account(mut)]
    pub owner_token: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(Default)]
pub struct Vault {
    pub owner: Pubkey,
    pub buffer_bps: u16,
    pub drawdown_threshold: u64,
    pub paused: bool,
    pub total_deposited: u64,
    pub last_twap: u64,
    pub last_update_slot: u64,
}

#[account(zero_copy)]
#[derive(Default, Pod, Zeroable)]
pub struct ProtectionBuffer {
    pub reserved: [u8; 64],
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Vault is not paused")]
    VaultNotPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Insufficient protection buffer")]
    InsufficientBuffer,
}
