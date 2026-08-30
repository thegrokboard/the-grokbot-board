use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.buffer_bump = buffer_bump;
        vault.is_paused = false;
        vault.breaker_tripped = false;
        vault.last_twap = 0;
        vault.last_slot = Clock::get()?.slot;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, VaultError::VaultPaused);
        require!(!vault.breaker_tripped, VaultError::BreakerTripped);

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.user_token.to_account_info(),
            to: ctx.accounts.vault_token.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Update protection buffer accounting
        let buffer = &mut ctx.accounts.protection_buffer;
        buffer.total_deposited = buffer.total_deposited.saturating_add(amount);

        emit!(DepositEvent {
            user: ctx.accounts.user.key(),
            amount,
        });
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, VaultError::VaultPaused);
        require!(!vault.breaker_tripped, VaultError::BreakerTripped);

        let seeds = &[b"protection_buffer".as_ref(), &[vault.buffer_bump]];
        let signer = &[&seeds[..]];

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.vault_token.to_account_info(),
            to: ctx.accounts.user_token.to_account_info(),
            authority: ctx.accounts.protection_buffer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        let buffer = &mut ctx.accounts.protection_buffer;
        buffer.total_deposited = buffer.total_deposited.saturating_sub(amount);

        emit!(WithdrawEvent {
            user: ctx.accounts.user.key(),
            amount,
        });
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, VaultError::Unauthorized);
        vault.is_paused = true;
        emit!(PauseEvent { authority: ctx.accounts.authority.key() });
        Ok(())
    }

    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, VaultError::Unauthorized);
        vault.is_paused = false;
        emit!(UnpauseEvent { authority: ctx.accounts.authority.key() });
        Ok(())
    }

    pub fn check_drawdown(ctx: Context<CheckDrawdown>, current_price: u64, slot: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, VaultError::VaultPaused);

        let clock = Clock::get()?;
        let elapsed_slots = slot.saturating_sub(vault.last_slot);
        if elapsed_slots == 0 {
            return Ok(());
        }

        // 15s TWAP simulation (assuming ~0.4s per slot, ~37-38 slots per 15s)
        let new_twap = if vault.last_twap == 0 {
            current_price
        } else {
            (vault.last_twap * 3 + current_price) / 4 // EWMA approximation for TWAP
        };

        vault.last_twap = new_twap;
        vault.last_slot = slot;

        // JitoSOL depeg drawdown circuit breaker: trip if >12% drawdown from 15s TWAP
        let drawdown_threshold = 88; // 12% drawdown
        if new_twap > 0 && current_price * 100 < new_twap * drawdown_threshold as u64 {
            vault.breaker_tripped = true;
            emit!(BreakerTrippedEvent {
                twap: new_twap,
                current_price,
                slot,
            });
        }

        emit!(TwapUpdateEvent {
            old_twap: vault.last_twap,
            new_twap,
            current_price,
            slot,
        });
        Ok(())
    }

    pub fn owner_withdraw(ctx: Context<OwnerWithdraw>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, VaultError::Unauthorized);
        require!(vault.breaker_tripped, VaultError::BreakerNotTripped);

        let seeds = &[b"protection_buffer".as_ref(), &[vault.buffer_bump]];
        let signer = &[&seeds[..]];

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.vault_token.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.protection_buffer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        emit!(OwnerWithdrawEvent {
            owner: ctx.accounts.authority.key(),
            amount,
        });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(owner: Pubkey, buffer_bump: u8)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 128)]
    pub vault: Account<'info, VaultState>,
    #[account(
        init,
        seeds = [b"protection_buffer"],
        bump = buffer_bump,
        payer = payer,
        space = 8 + 64
    )]
    pub protection_buffer: Account<'info, ProtectionBuffer>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
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
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    #[account(mut, seeds = [b"protection_buffer"], bump = vault.buffer_bump)]
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
    pub vault: Account<'info, VaultState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Unpause<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CheckDrawdown<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    pub authority: Signer<'info>, // oracle or authorized updater
}

#[derive(Accounts)]
pub struct OwnerWithdraw<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    #[account(mut, seeds = [b"protection_buffer"], bump = vault.buffer_bump)]
    pub protection_buffer: Account<'info, ProtectionBuffer>,
    #[account(mut)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct VaultState {
    pub owner: Pubkey,
    pub buffer_bump: u8,
    pub is_paused: bool,
    pub breaker_tripped: bool,
    pub last_twap: u64,
    pub last_slot: u64,
}

#[account]
pub struct ProtectionBuffer {
    pub total_deposited: u64,
    pub reserved: u64,
}

#[event]
pub struct DepositEvent {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct WithdrawEvent {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PauseEvent {
    pub authority: Pubkey,
}

#[event]
pub struct UnpauseEvent {
    pub authority: Pubkey,
}

#[event]
pub struct BreakerTrippedEvent {
    pub twap: u64,
    pub current_price: u64,
    pub slot: u64,
}

#[event]
pub struct TwapUpdateEvent {
    pub old_twap: u64,
    pub new_twap: u64,
    pub current_price: u64,
    pub slot: u64,
}

#[event]
pub struct OwnerWithdrawEvent {
    pub owner: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum VaultError {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Circuit breaker has been tripped")]
    BreakerTripped,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Breaker not tripped - cannot perform owner withdraw")]
    BreakerNotTripped,
}
