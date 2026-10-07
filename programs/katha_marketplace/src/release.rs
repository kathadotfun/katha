use crate::*;
use katha_registry::{program::KathaRegistry, ArtworkRecord, KathaConfig};
use mpl_core::{
    instructions::{RevokePluginAuthorityV1CpiBuilder, UpdatePluginV1CpiBuilder},
    types::{FreezeDelegate, Plugin, PluginType, UpdateAuthority},
    AuthorityType,
};

#[derive(Accounts)]
pub struct ReleaseListing<'info> {
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
    /// CHECK: Canonical Core asset, parsed before invoking Core.
    #[account(mut, seeds = [katha_registry::CORE_ASSET_SEED, artwork.key().as_ref()], bump,
        seeds::program = registry_program.key(), owner = mpl_core::ID @ MarketplaceError::InvalidArtwork)]
    pub asset: UncheckedAccount<'info>,
    #[account(mut, seeds = [LISTING_SEED, asset.key().as_ref()], bump = listing.bump,
        constraint = listing.config == config.key() @ MarketplaceError::InvalidListing,
        constraint = listing.artwork == artwork.key() @ MarketplaceError::InvalidListing,
        constraint = listing.asset == asset.key() @ MarketplaceError::InvalidListing)]
    pub listing: Box<Account<'info, ListingRecord>>,
    #[account(mut)]
    pub actor: Signer<'info>,
    /// CHECK: Fixed Registry collection; its update authority is checked below.
    #[account(mut, address = config.collection, owner = mpl_core::ID @ MarketplaceError::InvalidArtwork)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: Fixed executable Core program.
    #[account(address = mpl_core::ID, executable)]
    pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> ReleaseListing<'info> {
    pub fn release(&mut self, expected_revision: u64, expired: bool) -> Result<()> {
        require!(
            self.config.version == 1 && self.listing.version == 1,
            MarketplaceError::InvalidListing
        );
        require!(
            self.listing.status == ListingStatus::Active,
            MarketplaceError::ListingNotActive
        );
        require!(
            self.listing.revision == expected_revision,
            MarketplaceError::StaleListingRevision
        );
        let now = Clock::get()?.unix_timestamp;
        if expired {
            require!(
                now >= self.listing.expires_at,
                MarketplaceError::ListingNotExpired
            );
        } else {
            require_keys_eq!(
                self.actor.key(),
                self.listing.seller,
                MarketplaceError::UnauthorizedSeller
            );
        }
        let revision = self.listing.next_revision()?;
        let remove_transfer = {
            let data = self.asset.try_borrow_data()?;
            let asset = mpl_core::Asset::from_bytes(&data)
                .map_err(|_| error!(MarketplaceError::InvalidArtwork))?;
            require_keys_eq!(
                asset.base.owner,
                self.listing.seller,
                MarketplaceError::UnauthorizedSeller
            );
            require!(
                asset.base.name == self.artwork.katha_id
                    && asset.base.update_authority
                        == UpdateAuthority::Collection(self.collection.key()),
                MarketplaceError::InvalidArtwork
            );
            let freeze = asset
                .plugin_list
                .freeze_delegate
                .as_ref()
                .ok_or_else(|| error!(MarketplaceError::InvalidListingDelegates))?;
            require!(
                freeze.freeze_delegate.frozen
                    && freeze.base.authority.authority_type == AuthorityType::Address
                    && freeze.base.authority.address == Some(self.listing.key()),
                MarketplaceError::InvalidListingDelegates
            );
            // An owner may revoke its transfer permission. Never remove someone else's grant.
            asset
                .plugin_list
                .transfer_delegate
                .as_ref()
                .is_some_and(|plugin| {
                    plugin.base.authority.authority_type == AuthorityType::Address
                        && plugin.base.authority.address == Some(self.listing.key())
                })
        };
        {
            let data = self.collection.try_borrow_data()?;
            let collection = mpl_core::Collection::from_bytes(&data)
                .map_err(|_| error!(MarketplaceError::InvalidArtwork))?;
            require_keys_eq!(
                collection.base.update_authority,
                self.registry_config.collection_authority,
                MarketplaceError::InvalidArtwork
            );
        }
        let core = self.core_program.to_account_info();
        let asset = self.asset.to_account_info();
        let collection = self.collection.to_account_info();
        let actor = self.actor.to_account_info();
        let listing = self.listing.to_account_info();
        let system = self.system_program.to_account_info();
        let asset_key = self.asset.key();
        let bump = [self.listing.bump];
        let seeds: &[&[u8]] = &[LISTING_SEED, asset_key.as_ref(), &bump];
        UpdatePluginV1CpiBuilder::new(&core)
            .asset(&asset)
            .collection(Some(&collection))
            .payer(&actor)
            .authority(Some(&listing))
            .system_program(&system)
            .plugin(Plugin::FreezeDelegate(FreezeDelegate { frozen: false }))
            .invoke_signed(&[seeds])?;
        for plugin_type in [PluginType::TransferDelegate, PluginType::FreezeDelegate] {
            if plugin_type == PluginType::TransferDelegate && !remove_transfer {
                continue;
            }
            RevokePluginAuthorityV1CpiBuilder::new(&core)
                .asset(&asset)
                .collection(Some(&collection))
                .payer(&actor)
                .authority(Some(&listing))
                .system_program(&system)
                .plugin_type(plugin_type)
                .invoke_signed(&[seeds])?;
        }
        self.listing.status = if expired {
            ListingStatus::Expired
        } else {
            ListingStatus::Cancelled
        };
        self.listing.revision = revision;
        emit!(ListingReleased {
            listing: self.listing.key(),
            artwork: self.artwork.key(),
            asset: asset_key,
            seller: self.listing.seller,
            actor: self.actor.key(),
            revision,
            status: self.listing.status,
            released_at: now
        });
        Ok(())
    }
}

#[event]
pub struct ListingReleased {
    pub listing: Pubkey,
    pub artwork: Pubkey,
    pub asset: Pubkey,
    pub seller: Pubkey,
    pub actor: Pubkey,
    pub revision: u64,
    pub status: ListingStatus,
    pub released_at: i64,
}
