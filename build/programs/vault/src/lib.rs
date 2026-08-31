use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg6M7S2zq9Q9");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.is_paused = false;
        vault.jitosol_mint = ctx.accounts.jitosol_mint.key();
        vault.protection_buffer = ctx.accounts.protection_buffer.key();
        vault.last_twap = 0;
        vault.last_twap_slot = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.user_jitosol.to_account_info(),
            to: ctx.accounts.vault_jitosol.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // In real version this would update internal accounting; here we just accept deposit
        Ok(())
    }

    pub fn pause(ctx: Context<OwnerAction>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.signer.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<OwnerAction>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.signer.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = false;
        Ok(())
    }

    pub fn check_and_trigger_drawdown(ctx: Context<CheckDrawdown>, current_price: u64, current_slot: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        let twap = calculate_twap(vault.last_twap, vault.last_twap_slot, current_price, current_slot);
        vault.last_twap = twap;
        vault.last_twap_slot = current_slot;

        // Simple 15% drawdown threshold from normalized 1.0 = 1_000_000
        if twap < 850_000 {
            // Trigger circuit breaker: in full impl this would transfer out to buffer or emit event
            emit!(DrawdownTriggered {
                twap,
                current_slot,
            });
        }
        Ok(())
    }

    pub fn withdraw_from_buffer(ctx: Context<WithdrawBuffer>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.signer.key() == vault.owner, ErrorCode::Unauthorized);
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        let seeds = &[b"vault".as_ref(), &[ctx.bumps.vault]];
        let signer = &[&seeds[..]];

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.vault_jitosol.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer,
        );
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 8 + 32 + 1 + 32 + 32 + 8 + 8, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    pub jitosol_mint: Account<'info, Mint>,
    #[account(mut)]
    pub protection_buffer: Account<'info, TokenAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub user_jitosol: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_jitosol: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct OwnerAction<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct CheckDrawdown<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawBuffer<'info> {
    #[account(seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub vault_jitosol: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub signer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct VaultState {
    pub owner: Pubkey,
    pub is_paused: bool,
    pub jitosol_mint: Pubkey,
    pub protection_buffer: Pubkey,
    pub last_twap: u64,
    pub last_twap_slot: u64,
}

#[event]
pub struct DrawdownTriggered {
    pub twap: u64,
    pub current_slot: u64,
}

fn calculate_twap(last_twap: u64, last_slot: u64, current_price: u64, current_slot: u64) -> u64 {
    if last_slot == 0 {
        return current_price;
    }
    let slots_delta = current_slot.saturating_sub(last_slot);
    if slots_delta == 0 {
        return last_twap;
    }
    // Very simple EMA-style TWAP over slots (for sim purposes)
    let weight = std::cmp::min(slots_delta, 15);
    ((last_twap * (15 - weight) + current_price * weight) / 15)
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized")]
    Unauthorized,
}
