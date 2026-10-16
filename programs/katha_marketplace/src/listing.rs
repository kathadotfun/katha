use crate::*;
use anchor_lang::system_program;
use katha_registry::{
    program::KathaRegistry, ArtworkRecord, ArtworkVerification, ConditionAttestation,
    ConditionHead, CustodyHead, KathaConfig,
};
use mpl_core::{
    instructions::{
        AddPluginV1CpiBuilder, ApprovePluginAuthorityV1CpiBuilder, UpdatePluginV1CpiBuilder,
    },
    types::{FreezeDelegate, Plugin, PluginAuthority, PluginType, TransferDelegate},
    AuthorityType,
};

#[derive(Accounts)]
pub struct CreateListing<'info> {
    #[account(seeds = [MARKETPLACE_CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, MarketplaceConfig>>,
    #[account(address = config.registry_program)]
    pub registry_program: Program<'info, KathaRegistry>,
    #[account(seeds = [katha_registry::CONFIG_SEED], bump = registry_config.bump, seeds::program = registry_program.key(),
        address = config.registry_config, constraint = registry_config.collection == config.collection @ MarketplaceError::InvalidArtwork)]
    pub registry_config: Box<Account<'info, KathaConfig>>,
    #[account(seeds = [katha_registry::ARTWORK_SEED, artwork.katha_id.as_bytes()], bump = artwork.bump,
        seeds::program = registry_program.key(), constraint = artwork.collection == config.collection @ MarketplaceError::InvalidArtwork,
        constraint = artwork.core_asset == Some(asset.key()) @ MarketplaceError::InvalidArtwork)]
    pub artwork: Box<Account<'info, ArtworkRecord>>,
    #[account(seeds = [katha_registry::VERIFICATION_SEED, artwork.key().as_ref()], bump = verification.bump,
        seeds::program = registry_program.key(), constraint = verification.artwork == artwork.key() @ MarketplaceError::InvalidAttestation)]
    pub verification: Account<'info, ArtworkVerification>,
    #[account(seeds = [katha_registry::CONDITION_HEAD_SEED, artwork.key().as_ref()], bump = condition_head.bump,
        seeds::program = registry_program.key(), constraint = condition_head.artwork == artwork.key() @ MarketplaceError::InvalidAttestation,
        constraint = condition_head.current_report == condition_report.key() @ MarketplaceError::InvalidAttestation)]
    pub condition_head: Account<'info, ConditionHead>,
    #[account(seeds = [katha_registry::CONDITION_REPORT_SEED, &condition_report.report_id], bump = condition_report.bump,
        seeds::program = registry_program.key(), constraint = condition_report.artwork == artwork.key() @ MarketplaceError::InvalidAttestation)]
    pub condition_report: Box<Account<'info, ConditionAttestation>>,
    #[account(seeds = [katha_registry::CUSTODY_HEAD_SEED, artwork.key().as_ref()], bump = custody_head.bump,
        seeds::program = registry_program.key(), constraint = custody_head.artwork == artwork.key() @ MarketplaceError::InvalidCustody)]
    pub custody_head: Account<'info, CustodyHead>,
    #[account(seeds = [SALE_TERMS_SEED, artwork.key().as_ref()], bump = sale_terms.bump,
        constraint = sale_terms.artwork == artwork.key() @ MarketplaceError::InvalidArtistPayout)]
    pub sale_terms: Account<'info, ArtworkSaleTerms>,
    /// CHECK: Canonical Registry-derived Core account; handler parses identity and owner.
    #[account(mut, seeds = [katha_registry::CORE_ASSET_SEED, artwork.key().as_ref()], bump,
        seeds::program = registry_program.key(), owner = mpl_core::ID @ MarketplaceError::InvalidArtwork)]
    pub asset: UncheckedAccount<'info>,
    #[account(mut)]
    pub seller: Signer<'info>,
    /// CHECK: Canonical persistent Marketplace ledger; handler validates/allocates/serializes.
    #[account(mut, seeds = [LISTING_SEED, asset.key().as_ref()], bump)]
    pub listing: UncheckedAccount<'info>,
    /// CHECK: Registry-bound Core collection; handler rejects unexpected plugins/authority.
    #[account(mut, address = config.collection, owner = mpl_core::ID @ MarketplaceError::InvalidArtwork)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: Fixed executable Core program, passed to its standard CPI interface.
    #[account(address = mpl_core::ID, executable)]
    pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    #[account(seeds = [FEE_SCHEDULE_SEED], bump = fee_schedule.bump,
        constraint = fee_schedule.config == config.key() && fee_schedule.version == 1 @ MarketplaceError::InvalidFeeSchedule)]
    pub fee_schedule: Account<'info, FeeSchedule>,
    /// CHECK: Canonical snapshot is allocated/validated by snapshot_listing_fees.
    #[account(mut, seeds = [LISTING_FEES_SEED, listing.key().as_ref()], bump)]
    pub listing_fees: UncheckedAccount<'info>,
}

impl<'info> CreateListing<'info> {
    pub fn create(
        &self,
        price: u64,
        expires_at: i64,
        expected_revision: u64,
        bump: u8,
        fees_bump: u8,
        expected_commission_bps: u16,
        expected_secondary_royalty_bps: u16,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        validate_listing_terms(price, expires_at, now)?;
        let existing = if *self.listing.owner == crate::ID {
            let data = self.listing.try_borrow_data()?;
            require!(
                data.len() == ListingRecord::SPACE,
                MarketplaceError::InvalidListing
            );
            let record = ListingRecord::try_deserialize(&mut &data[..])?;
            require!(
                matches!(record.version, 1 | 2)
                    && record.config == self.config.key()
                    && record.artwork == self.artwork.key()
                    && record.asset == self.asset.key()
                    && record.artist_payout == self.sale_terms.artist_payout
                    && record.payment_mint == self.config.payment_mint
                    && record.bump == bump,
                MarketplaceError::InvalidListing
            );
            require!(
                record.status != ListingStatus::Active,
                MarketplaceError::ListingAlreadyActive
            );
            Some(record)
        } else {
            require!(
                *self.listing.owner == system_program::ID && self.listing.data_is_empty(),
                MarketplaceError::InvalidListing
            );
            None
        };
        let (revision, completed_sales) = match existing.as_ref() {
            Some(record) => {
                require!(
                    record.revision == expected_revision,
                    MarketplaceError::StaleListingRevision
                );
                (record.next_revision()?, record.completed_sales)
            }
            None => {
                require!(
                    expected_revision == 0,
                    MarketplaceError::StaleListingRevision
                );
                (1, 0)
            }
        };
        let kind = if completed_sales == 0 {
            SaleKind::Primary
        } else {
            SaleKind::Secondary
        };
        let (commission, royalty) = if kind == SaleKind::Primary {
            (self.fee_schedule.primary_commission_bps, 0)
        } else {
            (
                self.fee_schedule.secondary_commission_bps,
                self.fee_schedule.secondary_royalty_bps,
            )
        };
        require!(
            commission == expected_commission_bps && royalty == expected_secondary_royalty_bps,
            MarketplaceError::StaleFeeSchedule
        );
        LiveEligibility {
            config: &self.config,
            registry_config: &self.registry_config,
            artwork: &self.artwork,
            verification: &self.verification,
            condition_head: &self.condition_head,
            condition_report: &self.condition_report,
            custody_head: &self.custody_head,
            sale_terms: &self.sale_terms,
            asset: self.asset.to_account_info(),
            seller: self.seller.key(),
        }
        .validate(kind, now)?;
        snapshot_listing_fees(
            &self.listing_fees,
            &self.seller,
            self.listing.key(),
            revision,
            kind,
            &self.fee_schedule,
            fees_bump,
        )?;
        let reusable = {
            let data = self.asset.try_borrow_data()?;
            let asset = mpl_core::Asset::from_bytes(&data)
                .map_err(|_| error!(MarketplaceError::InvalidArtwork))?;
            if existing.is_none() {
                require_no_plugins(&data, asset.plugin_header.as_ref())?;
            } else {
                require_reusable_plugins(&data, &asset)?;
            }
            let reusable = (
                asset.plugin_list.transfer_delegate.is_some(),
                asset.plugin_list.freeze_delegate.is_some(),
            );
            let data = self.collection.try_borrow_data()?;
            let collection = mpl_core::Collection::from_bytes(&data)
                .map_err(|_| error!(MarketplaceError::InvalidArtwork))?;
            require_keys_eq!(
                collection.base.update_authority,
                self.registry_config.collection_authority,
                MarketplaceError::InvalidArtwork
            );
            require_no_plugins(&data, collection.plugin_header.as_ref())?;
            reusable
        };
        let asset_key = self.asset.key();
        let seeds: &[&[u8]] = &[LISTING_SEED, asset_key.as_ref(), &[bump]];
        if existing.is_none() {
            // Allocate even if a third party prefunded the PDA; never reset owned history.
            let rent = Rent::get()?.minimum_balance(ListingRecord::SPACE);
            let missing = rent.saturating_sub(self.listing.lamports());
            if missing > 0 {
                system_program::transfer(
                    CpiContext::new(
                        system_program::ID,
                        system_program::Transfer {
                            from: self.seller.to_account_info(),
                            to: self.listing.to_account_info(),
                        },
                    ),
                    missing,
                )?;
            }
            system_program::allocate(
                CpiContext::new_with_signer(
                    system_program::ID,
                    system_program::Allocate {
                        account_to_allocate: self.listing.to_account_info(),
                    },
                    &[seeds],
                ),
                ListingRecord::SPACE as u64,
            )?;
            system_program::assign(
                CpiContext::new_with_signer(
                    system_program::ID,
                    system_program::Assign {
                        account_to_assign: self.listing.to_account_info(),
                    },
                    &[seeds],
                ),
                &crate::ID,
            )?;
        }
        let core = self.core_program.to_account_info();
        let asset = self.asset.to_account_info();
        let collection = self.collection.to_account_info();
        let seller = self.seller.to_account_info();
        let system = self.system_program.to_account_info();
        // Install transfer authorization first, then freeze. No intermediate state commits.
        for (plugin, plugin_type, reuse) in [
            (
                Plugin::TransferDelegate(TransferDelegate {}),
                PluginType::TransferDelegate,
                reusable.0,
            ),
            (
                Plugin::FreezeDelegate(FreezeDelegate { frozen: true }),
                PluginType::FreezeDelegate,
                reusable.1,
            ),
        ] {
            if reuse {
                // Cleanup returns owner-managed permissions; reapprove them rather than reallocating.
                ApprovePluginAuthorityV1CpiBuilder::new(&core)
                    .asset(&asset)
                    .collection(Some(&collection))
                    .payer(&seller)
                    .authority(Some(&seller))
                    .system_program(&system)
                    .plugin_type(plugin_type.clone())
                    .new_authority(PluginAuthority::Address {
                        address: self.listing.key(),
                    })
                    .invoke()?;
                if plugin_type == PluginType::FreezeDelegate {
                    UpdatePluginV1CpiBuilder::new(&core)
                        .asset(&asset)
                        .collection(Some(&collection))
                        .payer(&seller)
                        .authority(Some(&self.listing.to_account_info()))
                        .system_program(&system)
                        .plugin(plugin)
                        .invoke_signed(&[seeds])?;
                }
            } else {
                AddPluginV1CpiBuilder::new(&core)
                    .asset(&asset)
                    .collection(Some(&collection))
                    .payer(&seller)
                    .authority(Some(&seller))
                    .system_program(&system)
                    .plugin(plugin)
                    .init_authority(PluginAuthority::Address {
                        address: self.listing.key(),
                    })
                    .invoke()?;
            }
        }
        let record = ListingRecord {
            version: 2,
            config: self.config.key(),
            artwork: self.artwork.key(),
            asset: asset_key,
            seller: self.seller.key(),
            artist_payout: self.sale_terms.artist_payout,
            payment_mint: self.config.payment_mint,
            condition_report: self.condition_report.key(),
            condition_hash: self.condition_report.report_hash,
            condition_version: self.condition_report.version,
            custody_revision: self.custody_head.revision,
            price,
            created_at: now,
            expires_at,
            revision,
            completed_sales,
            sale_kind: kind,
            status: ListingStatus::Active,
            bump,
        };
        record.try_serialize(&mut &mut self.listing.try_borrow_mut_data()?[..])?;
        emit!(ListingCreated {
            listing: self.listing.key(),
            artwork: record.artwork,
            asset: record.asset,
            seller: record.seller,
            artist_payout: record.artist_payout,
            payment_mint: record.payment_mint,
            price,
            revision,
            sale_kind: kind,
            condition_report: record.condition_report,
            condition_hash: record.condition_hash,
            condition_version: record.condition_version,
            custody_revision: record.custody_revision,
            created_at: now,
            expires_at
        });
        Ok(())
    }
}

fn require_reusable_plugins(data: &[u8], asset: &mpl_core::Asset) -> Result<()> {
    if let Some(header) = asset.plugin_header.as_ref() {
        let offset = usize::try_from(header.plugin_registry_offset)
            .map_err(|_| error!(MarketplaceError::ConflictingCorePlugins))?;
        let registry = mpl_core::PluginRegistryV1Safe::from_bytes(
            data.get(offset..)
                .ok_or_else(|| error!(MarketplaceError::ConflictingCorePlugins))?,
        )
        .map_err(|_| error!(MarketplaceError::ConflictingCorePlugins))?;
        require!(
            registry.external_registry.is_empty()
                && registry.registry.iter().all(|entry| entry.plugin_type
                    == PluginType::FreezeDelegate as u8
                    || entry.plugin_type == PluginType::TransferDelegate as u8),
            MarketplaceError::ConflictingCorePlugins
        );
    }
    if let Some(plugin) = asset.plugin_list.freeze_delegate.as_ref() {
        require!(
            !plugin.freeze_delegate.frozen
                && plugin.base.authority.authority_type == AuthorityType::Owner,
            MarketplaceError::ConflictingCorePlugins
        );
    }
    if let Some(plugin) = asset.plugin_list.transfer_delegate.as_ref() {
        require!(
            plugin.base.authority.authority_type == AuthorityType::Owner,
            MarketplaceError::ConflictingCorePlugins
        );
    }
    Ok(())
}

pub(crate) fn require_no_plugins(
    data: &[u8],
    header: Option<&mpl_core::accounts::PluginHeaderV1>,
) -> Result<()> {
    if let Some(header) = header {
        let offset = usize::try_from(header.plugin_registry_offset)
            .map_err(|_| error!(MarketplaceError::ConflictingCorePlugins))?;
        let registry_data = data
            .get(offset..)
            .ok_or_else(|| error!(MarketplaceError::ConflictingCorePlugins))?;
        let registry = mpl_core::PluginRegistryV1Safe::from_bytes(registry_data)
            .map_err(|_| error!(MarketplaceError::ConflictingCorePlugins))?;
        require!(
            registry.registry.is_empty() && registry.external_registry.is_empty(),
            MarketplaceError::ConflictingCorePlugins
        );
    }
    Ok(())
}

#[event]
pub struct ListingCreated {
    pub listing: Pubkey,
    pub artwork: Pubkey,
    pub asset: Pubkey,
    pub seller: Pubkey,
    pub artist_payout: Pubkey,
    pub payment_mint: Pubkey,
    pub price: u64,
    pub revision: u64,
    pub sale_kind: SaleKind,
    pub condition_report: Pubkey,
    pub condition_hash: [u8; 32],
    pub condition_version: u32,
    pub custody_revision: u64,
    pub created_at: i64,
    pub expires_at: i64,
}
