use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};
use katha_registry::{program::KathaRegistry, KathaConfig};

pub mod multisig;
pub use multisig::*;
pub mod distribution;
pub use distribution::*;
pub mod eligibility;
pub use eligibility::*;
pub mod listing;
pub use listing::*;
pub mod purchase;
pub use purchase::*;
pub mod release;
pub use release::*;
pub mod fees;
pub use fees::*;

declare_id!("B7q1HFwusCjndtLaTd75wUCSTPtrYw88ABAonLw4b8Lq");

pub const MARKETPLACE_CONFIG_SEED: &[u8] = b"marketplace-config";
pub const PAYMENT_DECIMALS: u8 = 6;
pub const BASIS_POINTS_DENOMINATOR: u32 = 10_000;

#[program]
pub mod katha_marketplace {
    use super::*;

    /// The vault must accept through Squads CPI; a member wallet cannot substitute for it.
    pub fn transfer_multisig_authority(
        ctx: Context<TransferMultisigAuthority>,
        expected_authority: Pubkey,
        vault_index: u8,
        expected_members: [Pubkey; 3],
        expected_time_lock: u32,
    ) -> Result<()> {
        use crate::MarketplaceError as MultisigAuthorityError;
        use katha_registry::multisig::validate_squads_vault;
        require_keys_eq!(
            ctx.accounts.config.authority,
            expected_authority,
            MultisigAuthorityError::StaleAuthority
        );
        validate_squads_vault(
            &ctx.accounts.multisig.to_account_info(),
            ctx.accounts.new_authority.key(),
            vault_index,
            expected_members,
            expected_time_lock,
        )
        .map_err(|_| error!(MarketplaceError::InvalidMultisig))?;
        require_keys_neq!(
            expected_authority,
            ctx.accounts.new_authority.key(),
            MultisigAuthorityError::UnchangedAuthority
        );
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.new_authority.key();
        emit!(MarketplaceMultisigAuthorityTransferred {
            config: config.key(),
            previous_authority: expected_authority,
            authority: config.authority,
            multisig: ctx.accounts.multisig.key(),
            vault_index,
            members: expected_members,
            time_lock: expected_time_lock,
        });
        Ok(())
    }

    pub fn check_listing_fees(ctx: Context<CheckListingFees>) -> Result<()> {
        require!(
            ctx.accounts.listing.version == 2
                && ctx.accounts.listing.status == ListingStatus::Active,
            MarketplaceError::InvalidListingFees
        );
        ctx.accounts
            .listing_fees
            .validate(ctx.accounts.listing.key(), ctx.accounts.listing.revision)
    }

    pub fn initialize_fee_schedule(
        ctx: Context<InitializeFeeSchedule>,
        primary_commission_bps: u16,
        secondary_commission_bps: u16,
        secondary_royalty_bps: u16,
    ) -> Result<()> {
        let schedule = &mut ctx.accounts.fee_schedule;
        schedule.set_rates(
            primary_commission_bps,
            secondary_commission_bps,
            secondary_royalty_bps,
        )?;
        schedule.version = 1;
        schedule.config = ctx.accounts.config.key();
        schedule.revision = 1;
        schedule.bump = ctx.bumps.fee_schedule;
        schedule.changed(
            schedule.key(),
            ctx.accounts.config.collection,
            ctx.accounts.authority.key(),
        );
        Ok(())
    }

    pub fn update_fee_schedule(
        ctx: Context<UpdateFeeSchedule>,
        expected_revision: u64,
        primary_commission_bps: u16,
        secondary_commission_bps: u16,
        secondary_royalty_bps: u16,
    ) -> Result<()> {
        let schedule = &mut ctx.accounts.fee_schedule;
        require!(
            schedule.revision == expected_revision,
            MarketplaceError::StaleFeeSchedule
        );
        schedule.set_rates(
            primary_commission_bps,
            secondary_commission_bps,
            secondary_royalty_bps,
        )?;
        schedule.revision = schedule
            .revision
            .checked_add(1)
            .ok_or(MarketplaceError::StaleFeeSchedule)?;
        schedule.changed(
            schedule.key(),
            ctx.accounts.config.collection,
            ctx.accounts.authority.key(),
        );
        Ok(())
    }

    pub fn purchase_listing(
        ctx: Context<PurchaseListing>,
        expected_revision: u64,
        expected_price: u64,
    ) -> Result<()> {
        ctx.accounts.purchase(expected_revision, expected_price)
    }

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
        // Keep the discriminator and wire format for historical decoding. New
        // seller signatures must commit to a reviewed fee schedule revision.
        let _ = (ctx, price, expires_at, expected_revision);
        err!(MarketplaceError::FeeScheduleRequired)
    }

    pub fn create_listing_with_fees(
        ctx: Context<CreateListing>,
        price: u64,
        expires_at: i64,
        expected_revision: u64,
        expected_fee_revision: u64,
        expected_commission_bps: u16,
        expected_secondary_royalty_bps: u16,
    ) -> Result<()> {
        require!(
            ctx.accounts.fee_schedule.revision == expected_fee_revision,
            MarketplaceError::StaleFeeSchedule
        );
        ctx.accounts.create(
            price,
            expires_at,
            expected_revision,
            ctx.bumps.listing,
            ctx.bumps.listing_fees,
            expected_commission_bps,
            expected_secondary_royalty_bps,
        )
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
    #[msg("Reviewed listing price no longer matches")]
    StaleListingPrice,
    #[msg("Buyer cannot purchase their own listing")]
    InvalidBuyer,
    #[msg("Payment account owner, mint, state or alias is invalid")]
    InvalidPaymentAccount,
    #[msg("Buyer has insufficient test-token funds")]
    InsufficientPaymentFunds,
    #[msg("Fee schedule does not belong to this Marketplace")]
    InvalidFeeSchedule,
    #[msg("Fee schedule revision is stale or exhausted")]
    StaleFeeSchedule,
    #[msg("Listing fee snapshot is missing, invalid or stale")]
    InvalidListingFees,
    #[msg("Create listings with a reviewed fee schedule revision")]
    FeeScheduleRequired,
    #[msg("Root authority changed since this handover was reviewed")]
    StaleAuthority,
    #[msg("Multisig account is invalid or not the canonical Squads account")]
    InvalidMultisig,
    #[msg("Controlled multisigs are not accepted")]
    ControlledMultisig,
    #[msg("The accepted multisig threshold must be two")]
    InvalidThreshold,
    #[msg("Three distinct fully permitted members must match the reviewed order")]
    InvalidMembers,
    #[msg("The live multisig delay differs from the reviewed delay")]
    UnexpectedTimeLock,
    #[msg("The accepting signer is not the reviewed Squads vault")]
    InvalidVault,
    #[msg("ProgramData does not belong to the program being handed over")]
    InvalidMultisigProgramData,
    #[msg("Program upgrade authority must already be the accepting vault")]
    UpgradeAuthorityMismatch,
    #[msg("The accepting vault is already the root authority")]
    UnchangedAuthority,
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
