use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};

declare_id!("Vault1111111111111111111111111111111111111111");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey, drawdown_threshold: u64, buffer_bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = owner;
        vault.drawdown_threshold = drawdown_threshold;
        vault.is_paused = false;
        vault.buffer_bump = buffer_bump;
        vault.jito_mint = ctx.accounts.jito_mint.key();
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.user_token.to_account_info(),
            to: ctx.accounts.vault_token.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn owner_withdraw(ctx: Context<OwnerWithdraw>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(ctx.accounts.signer.key() == vault.owner, ErrorCode::Unauthorized);

        let seeds = &[b"buffer".as_ref(), &[vault.buffer_bump]];
        let signer = &[&seeds[..]];

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.vault_token.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.buffer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn toggle_pause(ctx: Context<TogglePause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.signer.key() == vault.owner, ErrorCode::Unauthorized);
        vault.is_paused = !vault.is_paused;
        Ok(())
    }

    pub fn trigger_drawdown(ctx: Context<TriggerDrawdown>) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(!vault.is_paused, ErrorCode::VaultPaused);

        let clock = Clock::get()?;
        let current_slot = clock.slot;

        let price = get_twap_price(&ctx.accounts.price_account, current_slot)?;
        let depeg_ratio = calculate_depeg_ratio(price);

        if depeg_ratio >= vault.drawdown_threshold {
            let seeds = &[b"buffer".as_ref(), &[vault.buffer_bump]];
            let signer = &[&seeds[..]];

            let cpi_accounts = token::Transfer {
                from: ctx.accounts.vault_token.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.buffer.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
            token::transfer(cpi_ctx, ctx.accounts.vault_token.amount)?;
        }

        Ok(())
    }
}

fn get_twap_price(price_account: &AccountInfo, current_slot: u64) -> Result<u64> {
    // Minimal on-chain TWAP stub: read last price (real impl would use Switchboard or custom TWAP)
    // For sim we assume oracle account data starts with u64 price after discriminator
    let data = price_account.try_borrow_data()?;
    if data.len() < 8 {
        return Err(ErrorCode::InvalidOracle.into());
    }
    let price = u64::from_le_bytes([data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7]]);
    Ok(price)
}

fn calculate_depeg_ratio(price: u64) -> u64 {
    // JitoSOL depeg modeled as basis points below 1.0 (e.g. 9500 = 5% depeg)
    if price >= 1_000_000 {
        0
    } else {
        (1_000_000 - price) / 100 // return percent depeg * 100
    }
}

#[derive(Accounts)]
#[instruction(owner: Pubkey, drawdown_threshold: u64, buffer_bump: u8)]
pub struct Initialize<'info> {
    #[account(init, payer = signer, space = 8 + 8 + 32 + 1 + 1 + 8 + 32)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub jito_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,
    #[account(mut, constraint = vault_token.mint == vault.jito_mint)]
    pub vault_token: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct OwnerWithdraw<'info> {
    #[account(mut, has_one = owner)]
    pub vault: Account<'info, VaultState>,
    #[account(mut, seeds = [b"buffer"], bump = vault.buffer_bump)]
    pub buffer: Account<'info, BufferAccount>,
    #[account(mut, constraint = vault_token.mint == vault.jito_mint)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct TogglePause<'info> {
    #[account(mut, has_one = owner)]
    pub vault: Account<'info, VaultState>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct TriggerDrawdown<'info> {
    #[account(mut, has_one = owner @ ErrorCode::Unauthorized)]
    pub vault: Account<'info, VaultState>,
    #[account(seeds = [b"buffer"], bump = vault.buffer_bump)]
    pub buffer: Account<'info, BufferAccount>,
    #[account(mut, constraint = vault_token.mint == vault.jito_mint)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    /// CHECK: oracle price account updated by lag injector
    pub price_account: AccountInfo<'info>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct VaultState {
    pub owner: Pubkey,
    pub drawdown_threshold: u64,
    pub is_paused: bool,
    pub buffer_bump: u8,
    pub jito_mint: Pubkey,
}

#[account]
pub struct BufferAccount {
    // Protection buffer PDA - holds no data, just signer
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Invalid oracle data")]
    InvalidOracle,
}
