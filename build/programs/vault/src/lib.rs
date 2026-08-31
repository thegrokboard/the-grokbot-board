use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.jito_sol_mint = ctx.accounts.jito_sol_mint.key();
        vault.buffer_bump = buffer_bump;
        vault.is_paused = false;
        vault.last_twap = 0;
        vault.last_slot = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, VaultError::VaultPaused);

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.user_token.to_account_info(),
            to: ctx.accounts.vault_token.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Update protection buffer tracking (simplified on-chain)
        let buffer = &mut ctx.accounts.protection_buffer;
        buffer.total_deposited = buffer
            .total_deposited
            .checked_add(amount)
            .ok_or(VaultError::Overflow)?;

        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, VaultError::Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, VaultError::Unauthorized);
        vault.is_paused = false;
        Ok(())
    }

    pub fn trigger_drawdown(ctx: Context<TriggerDrawdown>, current_price: u64, twap: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, VaultError::VaultPaused);

        // Simple 15% drawdown circuit breaker
        let threshold = vault.last_twap * 85 / 100;
        if current_price < threshold && twap < threshold {
            vault.is_paused = true;
            emit!(DrawdownTriggered {
                current_price,
                twap,
                slot: Clock::get()?.slot,
            });
        }

        vault.last_twap = twap;
        vault.last_slot = Clock::get()?.slot;
        Ok(())
    }

    pub fn withdraw_buffer(ctx: Context<WithdrawBuffer>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, VaultError::Unauthorized);
        require!(vault.is_paused, VaultError::NotPaused);

        let buffer = &mut ctx.accounts.protection_buffer;
        require!(
            amount <= buffer.total_deposited,
            VaultError::InsufficientBuffer
        );

        let seeds = &[
            b"protection_buffer".as_ref(),
            &vault.key().to_bytes()[..],
            &[vault.buffer_bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.buffer_token.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.buffer_account.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        buffer.total_deposited = buffer
            .total_deposited
            .checked_sub(amount)
            .ok_or(VaultError::Overflow)?;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(owner: Pubkey, buffer_bump: u8)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + Vault::LEN)]
    pub vault: Account<'info, Vault>,
    pub jito_sol_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = payer,
        seeds = [b"protection_buffer", vault.key().as_ref()],
        bump = buffer_bump,
        space = 8 + ProtectionBuffer::LEN
    )]
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
    pub protection_buffer: Account<'info, ProtectionBuffer>,
    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
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
pub struct TriggerDrawdown<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    // Oracle data passed via remaining accounts or CPI in real deployment
}

#[derive(Accounts)]
pub struct WithdrawBuffer<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub protection_buffer: Account<'info, ProtectionBuffer>,
    #[account(mut)]
    pub buffer_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub buffer_account: SystemAccount<'info>, // PDA signer
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub jito_sol_mint: Pubkey,
    pub buffer_bump: u8,
    pub is_paused: bool,
    pub last_twap: u64,
    pub last_slot: u64,
}

impl Vault {
    pub const LEN: usize = 32 + 32 + 1 + 1 + 8 + 8;
}

#[account]
pub struct ProtectionBuffer {
    pub total_deposited: u64,
}

impl ProtectionBuffer {
    pub const LEN: usize = 8;
}

#[event]
pub struct DrawdownTriggered {
    pub current_price: u64,
    pub twap: u64,
    pub slot: u64,
}

#[error_code]
pub enum VaultError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Vault is not paused")]
    NotPaused,
    #[msg("Insufficient buffer balance")]
    InsufficientBuffer,
    #[msg("Arithmetic overflow")]
    Overflow,
}
