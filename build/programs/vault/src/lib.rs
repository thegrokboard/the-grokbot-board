use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};
use std::mem;

declare_id!("Vau1t9z2z7z7z7z7z7z7z7z7z7z7z7z7z7z7z7z7");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, buffer_bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = *ctx.accounts.owner.key;
        vault.buffer_bump = buffer_bump;
        vault.is_paused = false;
        vault.protection_buffer = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_paused, VaultError::VaultPaused);
        // In sim, jitoSOL deposit is mocked via token transfer; here we just update buffer
        vault.protection_buffer = vault.protection_buffer.saturating_add(amount);
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, VaultError::Unauthorized);
        vault.is_paused = true;
        Ok(())
    }

    pub fn withdraw_buffer(ctx: Context<WithdrawBuffer>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(ctx.accounts.owner.key() == vault.owner, VaultError::Unauthorized);
        require!(amount <= vault.protection_buffer, VaultError::InsufficientBuffer);
        vault.protection_buffer = vault.protection_buffer.saturating_sub(amount);
        // Token transfer to owner would happen in real impl; omitted for sim
        Ok(())
    }

    pub fn check_drawdown(ctx: Context<CheckDrawdown>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let oracle = &ctx.accounts.oracle;
        require!(!vault.is_paused, VaultError::VaultPaused);

        let current_price = oracle.get_price();
        let current_slot = oracle.get_slot();

        // 15s TWAP logic is driven from TS side; here we enforce a simple drawdown circuit breaker
        // If price < 0.85 * last_known (simplified; real would use stored TWAP), trip breaker
        if current_price < 850_000_000u64 {  // assumes 1e9 scale for ~0.85
            vault.is_paused = true;
            msg!("Drawdown circuit breaker tripped at price {}", current_price);
        }
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = owner, space = 8 + 64, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawBuffer<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct CheckDrawdown<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account()]
    pub oracle: Account<'info, PriceAccount>,
    pub owner: Signer<'info>,
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub is_paused: bool,
    pub protection_buffer: u64,
    pub buffer_bump: u8,
}

#[derive(Clone, Copy)]
#[repr(C)]
#[derive(Pod, Zeroable)]
pub struct PriceAccount {
    pub price: u64,      // scaled price (e.g. 1e9 = $1)
    pub slot: u64,
    pub _padding: [u8; 16],
}

impl PriceAccount {
    pub fn get_price(&self) -> u64 {
        self.price
    }

    pub fn get_slot(&self) -> u64 {
        self.slot
    }
}

// Manual impls to avoid conflicts with Pod/Zeroable and Anchor serialization
impl anchor_lang::AccountSerialize for PriceAccount {
    fn try_serialize<W: std::io::Write>(&self, writer: &mut W) -> anchor_lang::Result<()> {
        let bytes = unsafe { mem::transmute::<&PriceAccount, &[u8; mem::size_of::<PriceAccount>()]>(self) };
        writer.write_all(bytes).map_err(|_| anchor_lang::error::ErrorCode::AccountDidNotSerialize)?;
        Ok(())
    }
}

impl anchor_lang::AccountDeserialize for PriceAccount {
    fn try_deserialize(buf: &mut &[u8]) -> anchor_lang::Result<Self> {
        if buf.len() < mem::size_of::<PriceAccount>() {
            return Err(anchor_lang::error::ErrorCode::AccountDidNotDeserialize.into());
        }
        let price_account: PriceAccount = unsafe { *(buf.as_ptr() as *const PriceAccount) };
        *buf = &buf[mem::size_of::<PriceAccount>()..];
        Ok(price_account)
    }

    fn try_deserialize_unchecked(buf: &mut &[u8]) -> anchor_lang::Result<Self> {
        Self::try_deserialize(buf)
    }
}

impl anchor_lang::Discriminator for PriceAccount {
    const DISCRIMINATOR: [u8; 8] = [0; 8];  // No discriminator for raw oracle-like account
}

#[error_code]
pub enum VaultError {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Unauthorized owner")]
    Unauthorized,
    #[msg("Insufficient protection buffer")]
    InsufficientBuffer,
}
