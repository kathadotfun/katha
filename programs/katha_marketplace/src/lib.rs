use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};
use katha_registry::{program::KathaRegistry, KathaConfig};

declare_id!("B7q1HFwusCjndtLaTd75wUCSTPtrYw88ABAonLw4b8Lq");

pub const MARKETPLACE_CONFIG_SEED: &[u8] = b"marketplace-config";
pub const PAYMENT_DECIMALS: u8 = 6;
pub const BASIS_POINTS_DENOMINATOR: u32 = 10_000;

#[program]
pub mod katha_marketplace {
    use super::*;

    pub fn initialize_marketplace(
        ctx: Context<InitializeMarketplace>,
        commission_bps: u16,
        secondary_royalty_bps: u16,
        inspection_validity_seconds: u64,
    ) -> Result<()> {
        validate_settings(
            commission_bps,
            secondary_royalty_bps,
            inspection_validity_seconds,
        )?;
        require!(
            ctx.accounts.authority.key() != Pubkey::default(),
            MarketplaceError::InvalidAuthority
        );
        require!(
            ctx.accounts.registry_config.treasury != Pubkey::default(),
            MarketplaceError::InvalidTreasury
        );
        let config = &mut ctx.accounts.config;
        config.version = 1;
        config.authority = ctx.accounts.authority.key();
        config.registry_program = ctx.accounts.registry_program.key();
        config.registry_config = ctx.accounts.registry_config.key();
        config.collection = ctx.accounts.registry_config.collection;
        config.treasury = ctx.accounts.registry_config.treasury;
        config.payment_mint = ctx.accounts.payment_mint.key();
        config.token_program = ctx.accounts.token_program.key();
        config.payment_decimals = PAYMENT_DECIMALS;
        config.commission_bps = commission_bps;
        config.secondary_royalty_bps = secondary_royalty_bps;
        config.inspection_validity_seconds = inspection_validity_seconds;
        config.bump = ctx.bumps.config;
        emit!(MarketplaceInitialized {
            config: config.key(),
            authority: config.authority,
            registry_program: config.registry_program,
            registry_config: config.registry_config,
            collection: config.collection,
            treasury: config.treasury,
            payment_mint: config.payment_mint,
            token_program: config.token_program,
            payment_decimals: config.payment_decimals,
            commission_bps,
            secondary_royalty_bps,
            inspection_validity_seconds,
        });
        Ok(())
    }
}

fn validate_settings(commission: u16, royalty: u16, validity: u64) -> Result<()> {
    // Sum in a wider type before bounding deductions; no u16 overflow or seller underflow.
    require!(
        u32::from(commission) + u32::from(royalty) <= BASIS_POINTS_DENOMINATOR,
        MarketplaceError::InvalidFees
    );
    // Later inspection-age calculations use the signed Unix timestamp domain.
    require!(
        validity > 0 && validity <= i64::MAX as u64,
        MarketplaceError::InvalidInspectionValidity
    );
    Ok(())
}

#[account]
pub struct MarketplaceConfig {
    pub version: u8,
    pub authority: Pubkey,
    pub registry_program: Pubkey,
    pub registry_config: Pubkey,
    pub collection: Pubkey,
    pub treasury: Pubkey,
    pub payment_mint: Pubkey,
    pub token_program: Pubkey,
    pub payment_decimals: u8,
    pub commission_bps: u16,
    pub secondary_royalty_bps: u16,
    pub inspection_validity_seconds: u64,
    pub bump: u8,
}
impl MarketplaceConfig {
    pub const SPACE: usize = 8 + 1 + 32 * 7 + 1 + 2 + 2 + 8 + 1;
}

#[derive(Accounts)]
pub struct InitializeMarketplace<'info> {
    #[account(init, payer = bootstrap_authority, space = MarketplaceConfig::SPACE, seeds = [MARKETPLACE_CONFIG_SEED], bump)]
    pub config: Account<'info, MarketplaceConfig>,
    #[account(mut)]
    pub bootstrap_authority: Signer<'info>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ MarketplaceError::InvalidProgramData)]
    pub program: Program<'info, crate::program::KathaMarketplace>,
    #[account(constraint = program_data.upgrade_authority_address == Some(bootstrap_authority.key()) @ MarketplaceError::UnauthorizedBootstrap)]
    pub program_data: Account<'info, ProgramData>,
    pub registry_program: Program<'info, KathaRegistry>,
    #[account(seeds = [b"katha-config"], bump = registry_config.bump, seeds::program = registry_program.key())]
    pub registry_config: Account<'info, KathaConfig>,
    #[account(address = registry_config.authority @ MarketplaceError::UnauthorizedAuthority)]
    pub authority: Signer<'info>,
    #[account(constraint = payment_mint.decimals == PAYMENT_DECIMALS @ MarketplaceError::InvalidPaymentMint,
        constraint = payment_mint.freeze_authority.is_none() @ MarketplaceError::InvalidPaymentMint)]
    pub payment_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct MarketplaceInitialized {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub registry_program: Pubkey,
    pub registry_config: Pubkey,
    pub collection: Pubkey,
    pub treasury: Pubkey,
    pub payment_mint: Pubkey,
    pub token_program: Pubkey,
    pub payment_decimals: u8,
    pub commission_bps: u16,
    pub secondary_royalty_bps: u16,
    pub inspection_validity_seconds: u64,
}

#[error_code]
pub enum MarketplaceError {
    #[msg("Bootstrap signer is not the Marketplace upgrade authority")]
    UnauthorizedBootstrap,
    #[msg("ProgramData does not belong to this Marketplace program")]
    InvalidProgramData,
    #[msg("Only the configured Registry authority can initialize Marketplace")]
    UnauthorizedAuthority,
    #[msg("Marketplace authority cannot be the default address")]
    InvalidAuthority,
    #[msg("Registry treasury cannot be the default address")]
    InvalidTreasury,
    #[msg("Payment mint must use six decimals and have no freeze authority")]
    InvalidPaymentMint,
    #[msg("Combined commission and secondary royalty exceed 10000 basis points")]
    InvalidFees,
    #[msg("Inspection validity must be positive and fit the signed timestamp domain")]
    InvalidInspectionValidity,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn settings_bounds() {
        for (commission, royalty, validity) in [
            (250, 500, 2_592_000),
            (0, 0, 1),
            (10_000, 0, i64::MAX as u64),
        ] {
            assert!(validate_settings(commission, royalty, validity).is_ok());
        }
        for (commission, royalty, validity) in [
            (10_000, 1, 1),
            (u16::MAX, u16::MAX, 1),
            (250, 500, 0),
            (250, 500, u64::MAX),
        ] {
            assert!(validate_settings(commission, royalty, validity).is_err());
        }
    }
}
