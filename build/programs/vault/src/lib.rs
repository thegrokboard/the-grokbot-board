use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

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
        vault.drawdown_threshold = 200; // 2% in bps
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.signer.key() == vault.owner, Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.signer.key() == vault.owner, Unauthorized);
        vault.is_paused = false;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, VaultPaused);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.user_jitosol.to_account_info(),
                    to: ctx.accounts.vault_jitosol.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        Ok(())
    }

    pub fn drawdown_circuit_breaker(ctx: Context<DrawdownCircuitBreaker>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, VaultPaused);

        // Placeholder for TWAP check (sim will drive via oracle lag)
        // In real sim this would be called by keeper when 15s TWAP shows depeg
        vault.is_paused = true;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.signer.key() == vault.owner, Unauthorized);
        require!(vault.is_paused, NotPaused);

        let seeds = &[
            b"buffer".as_ref(),
            &[vault.buffer_bump],
        ];
        let signer = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.vault_jitosol.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.buffer.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(buffer_bump: u8)]
pub struct Initialize<'info> {
    #[account(init, payer = signer, space = 8 + 128)]
    pub vault: Account<'info, Vault>,
    #[account(
        init,
        seeds = [b"buffer"],
        bump = buffer_bump,
        payer = signer,
        space = 8
    )]
    pub buffer: AccountInfo<'info>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub user_jitosol: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_jitosol: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct DrawdownCircuitBreaker<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    // oracle accounts would be added here in full impl
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        seeds = [b"buffer"],
        bump = vault.buffer_bump
    )]
    pub buffer: AccountInfo<'info>,
    #[account(mut)]
    pub vault_jitosol: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub signer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub buffer_bump: u8,
    pub is_paused: bool,
    pub last_twap: u64,
    pub drawdown_threshold: u16,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Vault must be paused to withdraw")]
    NotPaused,
}
