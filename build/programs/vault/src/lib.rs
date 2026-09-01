use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar;
use bytemuck::{Pod, Zeroable};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, max_drawdown_bps: u16) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.max_drawdown_bps = max_drawdown_bps;
        vault.is_paused = false;
        vault.last_update_slot = Clock::get()?.slot;
        vault.cumulative_twap = 0;
        vault.twap_samples = 0;
        Ok(())
    }

    pub fn update_price(ctx: Context<UpdatePrice>, price: u64, confidence: u64, slot: u64) -> Result<()> {
        let clock = Clock::get()?;
        require!(!ctx.accounts.vault.is_paused, ErrorCode::VaultPaused);

        let vault = &mut ctx.accounts.vault;
        let oracle = &mut ctx.accounts.oracle;

        oracle.price = price;
        oracle.confidence = confidence;
        oracle.slot = slot.max(clock.slot);

        // Simple incremental TWAP (15s target, but driven by tick-runner)
        let samples = vault.twap_samples as u128;
        if samples == 0 {
            vault.cumulative_twap = price as u128;
        } else {
            vault.cumulative_twap = (vault.cumulative_twap * samples + price as u128) / (samples + 1);
        }
        vault.twap_samples = samples.saturating_add(1) as u32;
        vault.last_update_slot = clock.slot;

        // Check drawdown against protection buffer
        if vault.twap_samples > 10 {
            let avg = (vault.cumulative_twap / samples) as u64;
            let drawdown_bps = if price >= avg {
                0u64
            } else {
                ((avg - price) as u128 * 10000) / avg as u128
            };
            if drawdown_bps > vault.max_drawdown_bps as u128 {
                vault.is_paused = true;
                emit!(DrawdownBreached {
                    current_price: price,
                    twap: avg,
                    drawdown_bps: drawdown_bps as u16,
                });
            }
        }
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn resume(ctx: Context<Resume>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = false;
        Ok(())
    }

    pub fn withdraw_buffer(ctx: Context<WithdrawBuffer>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.authority.key() == vault.owner, ErrorCode::Unauthorized);
        require!(ctx.accounts.vault.is_paused, ErrorCode::NotPaused);

        let transfer_amount = amount.min(ctx.accounts.buffer.lamports());
        let seeds = &[b"vault".as_ref(), &[ctx.bumps.vault]];
        let signer = &[&seeds[..]];

        anchor_lang::solana_program::program::invoke_signed(
            &anchor_lang::solana_program::system_instruction::transfer(
                &ctx.accounts.buffer.key(),
                &ctx.accounts.destination.key(),
                transfer_amount,
            ),
            &[
                ctx.accounts.buffer.to_account_info(),
                ctx.accounts.destination.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer,
        )?;

        emit!(BufferWithdrawn {
            amount: transfer_amount,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 8 + 32 + 2 + 1 + 8 + 8 + 4, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePrice<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub oracle: Account<'info, OraclePrice>,
    pub authority: Signer<'info>, // typically the lag injector / admin
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Resume<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawBuffer<'info> {
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub buffer: SystemAccount<'info>,
    #[account(mut)]
    pub destination: SystemAccount<'info>,
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(Default)]
pub struct Vault {
    pub owner: Pubkey,
    pub max_drawdown_bps: u16,
    pub is_paused: bool,
    pub last_update_slot: u64,
    pub cumulative_twap: u128,
    pub twap_samples: u32,
}

#[account]
#[derive(Default)]
pub struct OraclePrice {
    pub price: u64,
    pub confidence: u64,
    pub slot: u64,
}

// Pod wrapper used by sim for fast zero-copy updates
#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct OraclePricePod {
    pub price: u64,
    pub confidence: u64,
    pub slot: u64,
}

#[event]
pub struct DrawdownBreached {
    pub current_price: u64,
    pub twap: u64,
    pub drawdown_bps: u16,
}

#[event]
pub struct BufferWithdrawn {
    pub amount: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Vault must be paused for buffer withdraw")]
    NotPaused,
}
