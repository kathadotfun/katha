use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};
use katha_registry::{program::KathaRegistry, KathaConfig};

pub mod distribution;
pub use distribution::*;
pub mod eligibility;
pub use eligibility::*;
pub mod listing;
pub use listing::*;
pub mod release;
pub use release::*;

declare_id!("B7q1HFwusCjndtLaTd75wUCSTPtrYw88ABAonLw4b8Lq");

pub const MARKETPLACE_CONFIG_SEED: &[u8] = b"marketplace-config";
pub const PAYMENT_DECIMALS: u8 = 6;
pub const BASIS_POINTS_DENOMINATOR: u32 = 10_000;

#[program]
pub mod katha_marketplace {
    use super::*;

    pub fn cancel_listing(ctx: Context<ReleaseListing>, expected_revision: u64) -> Result<()> {
        ctx.accounts.release(expected_revision, false)
    }

    pub fn expire_listing(ctx: Context<ReleaseListing>, expected_revision: u64) -> Result<()> {
        ctx.accounts.release(expected_revision, true)
    }

    pub fn create_listing(
        ctx: Context<CreateListing>,
        price: u64,
        expires_at: i64,
        expected_revision: u64,
    ) -> Result<()> {
        ctx.accounts
            .create(price, expires_at, expected_revision, ctx.bumps.listing)
    }

    pub fn initialize_sale_terms(
        ctx: Context<InitializeSaleTerms>,
        artist_payout: Pubkey,
    ) -> Result<()> {
        require_keys_neq!(
            artist_payout,
            Pubkey::default(),
            MarketplaceError::InvalidArtistPayout
        );
        let terms = &mut ctx.accounts.sale_terms;
        terms.version = 1;
        terms.artwork = ctx.accounts.artwork.key();
        terms.artist_payout = artist_payout;
        terms.bump = ctx.bumps.sale_terms;
        Ok(())
    }

    // Read-only preview. Listing and purchase instructions must call the same validator.
    pub fn check_sale_eligibility(ctx: Context<CheckSaleEligibility>) -> Result<()> {
        ctx.accounts.validate(Clock::get()?.unix_timestamp)
    }

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
    validate_fees(commission, royalty)?;
    // Later inspection-age calculations use the signed Unix timestamp domain.
    require!(
        validity > 0 && validity <= i64::MAX as u64,
        MarketplaceError::InvalidInspectionValidity
    );
    Ok(())
}

fn validate_fees(commission: u16, royalty: u16) -> Result<()> {
    // Sum in a wider type before bounding deductions; no u16 overflow or seller underflow.
    require!(
        u32::from(commission) + u32::from(royalty) <= BASIS_POINTS_DENOMINATOR,
        MarketplaceError::InvalidFees
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
    #[msg("Artwork or Registry account does not match Marketplace configuration")]
    InvalidArtwork,
    #[msg("Seller must sign as the current Core owner")]
    UnauthorizedSeller,
    #[msg("Artwork verification or current condition commitment is invalid")]
    InvalidAttestation,
    #[msg("Artist payout must be configured and immutable")]
    InvalidArtistPayout,
    #[msg("Custody is unknown, in transit or unrelated to the current seller")]
    InvalidCustody,
    #[msg("Inspection does not approve the current custody and owner scope")]
    InvalidInspectionScope,
    #[msg("Collector inspection is expired or has an invalid timestamp")]
    ExpiredInspection,
    #[msg("Listing identity, version or primary-sale classification is invalid")]
    InvalidListing,
    #[msg("Listing price must be positive and expiry must be in the future")]
    InvalidListingTerms,
    #[msg("An active listing already exists; cancel or recover expiry first")]
    ListingAlreadyActive,
    #[msg("Listing revision does not match the reviewed revision")]
    StaleListingRevision,
    #[msg("Pre-existing Core plugins conflict with marketplace delegation")]
    ConflictingCorePlugins,
    #[msg("Listing is not active")]
    ListingNotActive,
    #[msg("Listing has not reached its expiry time")]
    ListingNotExpired,
    #[msg("Core freeze delegate does not match the active listing")]
    InvalidListingDelegates,
    #[msg("Sale price must be positive")]
    InvalidSalePrice,
    #[msg("Payment arithmetic overflow or underflow")]
    PaymentArithmeticOverflow,
    #[msg("Payment recipients cannot be default addresses")]
    InvalidPaymentRecipient,
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
