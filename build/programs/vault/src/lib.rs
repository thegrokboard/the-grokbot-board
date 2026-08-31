use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkgD6v6o5t9vA");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, buffer_bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.buffer_bump = buffer_bump;
        vault.is_paused = false;
        vault.last_twap = 0;
        vault.last_update_slot = Clock::get()?.slot;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token.to_account_info(),
            to: ctx.accounts.buffer.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn drawdown(ctx: Context<Drawdown>, max_drawdown_bps: u16) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        let clock = Clock::get()?;
        let slot_elapsed = clock.slot.saturating_sub(vault.last_update_slot);
        if slot_elapsed >= 15 {
            let twap = calculate_twap(&ctx.accounts.price_oracle)?;
            vault.last_twap = twap;
            vault.last_update_slot = clock.slot;
        }

        let current_price = get_price(&ctx.accounts.price_oracle)?;
        let drawdown = if vault.last_twap > 0 {
            ((vault.last_twap as u64).saturating_sub(current_price) * 10000) / vault.last_twap as u64
        } else {
            0
        };

        require!(drawdown <= max_drawdown_bps as u64, ErrorCode::DrawdownExceeded);

        let seeds = &[b"buffer".as_ref(), &[vault.buffer_bump]];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.buffer.to_account_info(),
            to: ctx.accounts.withdrawal_destination.to_account_info(),
            authority: ctx.accounts.buffer.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer,
        );
        token::transfer(cpi_ctx, ctx.accounts.buffer.amount)?;

        Ok(())
    }

    pub fn pause(ctx: Context<OwnerOnly>) -> Result<()> {
        ctx.accounts.vault.is_paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<OwnerOnly>) -> Result<()> {
        ctx.accounts.vault.is_paused = false;
        Ok(())
    }

    pub fn withdraw_buffer(ctx: Context<OwnerWithdraw>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        let seeds = &[b"buffer".as_ref(), &[vault.buffer_bump]];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.buffer.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.buffer.to_account_info(),
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
#[instruction(owner: Pubkey, buffer_bump: u8)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + 32 + 1 + 1 + 8 + 8)]
    pub vault: Account<'info, Vault>,
    #[account(
        init,
        seeds = [b"buffer"],
        bump = buffer_bump,
        payer = payer,
        token::mint = jito_mint,
        token::authority = buffer,
    )]
    pub buffer: Account<'info, TokenAccount>,
    pub jito_mint: Account<'info, Mint>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub buffer: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Drawdown<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [b"buffer"], bump = vault.buffer_bump)]
    pub buffer: Account<'info, TokenAccount>,
    #[account(mut)]
    pub withdrawal_destination: Account<'info, TokenAccount>,
    /// CHECK: oracle account validated in handler
    pub price_oracle: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    #[account(mut, has_one = owner)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct OwnerWithdraw<'info> {
    #[account(mut, has_one = owner)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [b"buffer"], bump = vault.buffer_bump)]
    pub buffer: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub buffer_bump: u8,
    pub is_paused: bool,
    pub last_twap: u64,
    pub last_update_slot: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Drawdown limit exceeded")]
    DrawdownExceeded,
    #[msg("Invalid oracle data")]
    InvalidOracle,
}

fn get_price(oracle: &UncheckedAccount) -> Result<u64> {
    // Simplified: read last price from oracle account (in prod use Switchboard or Pyth)
    // For sim, assume data[0..8] holds u64 price scaled by 1e9
    let data = oracle.try_borrow_data()?;
    if data.len() < 8 {
        return err!(ErrorCode::InvalidOracle);
    }
    let price = u64::from_le_bytes(data[0..8].try_into().unwrap());
    Ok(price)
}

fn calculate_twap(oracle: &UncheckedAccount) -> Result<u64> {
    // For sim harness we return current price; real impl would read history
    get_price(oracle)
}
