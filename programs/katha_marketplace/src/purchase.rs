use crate::*;
use anchor_spl::token::spl_token::state::AccountState;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use katha_registry::{
    program::KathaRegistry, ArtworkRecord, ArtworkVerification, ConditionAttestation,
    ConditionHead, CustodyHead, KathaConfig,
};
use mpl_core::{
    instructions::{
        RevokePluginAuthorityV1CpiBuilder, TransferV1CpiBuilder, UpdatePluginV1CpiBuilder,
    },
    types::{FreezeDelegate, Plugin, PluginType},
    AuthorityType,
};

#[derive(Accounts)]
pub struct PurchaseListing<'info> {
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
    /// CHECK: Recorded Core seller; purchase does not require a new seller signature.
    #[account(address = listing.seller)]
    pub seller: UncheckedAccount<'info>,
    #[account(mut, seeds = [LISTING_SEED, asset.key().as_ref()], bump = listing.bump,
        constraint = listing.config == config.key() && listing.artwork == artwork.key() && listing.asset == asset.key() @ MarketplaceError::InvalidListing)]
    pub listing: Box<Account<'info, ListingRecord>>,
    /// CHECK: Registry-bound Core collection; handler rejects unexpected plugins/authority.
    #[account(mut, address = config.collection, owner = mpl_core::ID @ MarketplaceError::InvalidArtwork)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: Fixed executable Core program, passed to its standard CPI interface.
    #[account(address = mpl_core::ID, executable)]
    pub core_program: UncheckedAccount<'info>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(address = config.payment_mint)]
    pub payment_mint: Account<'info, Mint>,
    #[account(address = config.token_program)]
    pub token_program: Program<'info, Token>,
    /// CHECK: Classic SPL account, parsed and checked for buyer ownership, mint, state and balance.
    #[account(mut, owner = anchor_spl::token::ID @ MarketplaceError::InvalidPaymentAccount)]
    pub buyer_tokens: UncheckedAccount<'info>,
    /// CHECK: Validated classic SPL payout account; shared role destinations are intentional.
    #[account(mut, dup, owner = anchor_spl::token::ID @ MarketplaceError::InvalidPaymentAccount)]
    pub seller_tokens: UncheckedAccount<'info>,
    /// CHECK: Validated classic SPL payout account; shared role destinations are intentional.
    #[account(mut, dup, owner = anchor_spl::token::ID @ MarketplaceError::InvalidPaymentAccount)]
    pub artist_tokens: UncheckedAccount<'info>,
    /// CHECK: Validated classic SPL payout account; shared role destinations are intentional.
    #[account(mut, dup, owner = anchor_spl::token::ID @ MarketplaceError::InvalidPaymentAccount)]
    pub treasury_tokens: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Version-2 listings require the owned canonical fee snapshot. Legacy
    /// listings use their immutable initialization settings, even after fee updates.
    #[account(seeds = [LISTING_FEES_SEED, listing.key().as_ref()], bump)]
    pub listing_fees: UncheckedAccount<'info>,
}

impl<'info> PurchaseListing<'info> {
    pub fn purchase(&mut self, expected_revision: u64, expected_price: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            matches!(self.listing.version, 1 | 2) && self.listing.status == ListingStatus::Active,
            MarketplaceError::ListingNotActive
        );
        require!(
            self.listing.revision == expected_revision,
            MarketplaceError::StaleListingRevision
        );
        require!(
            self.listing.price == expected_price,
            MarketplaceError::StaleListingPrice
        );
        validate_listing_terms(self.listing.price, self.listing.expires_at, now)?;
        require_keys_neq!(
            self.buyer.key(),
            self.listing.seller,
            MarketplaceError::InvalidBuyer
        );
        let kind = if self.listing.completed_sales == 0 {
            SaleKind::Primary
        } else {
            SaleKind::Secondary
        };
        require!(
            self.listing.sale_kind == kind
                && self.listing.artist_payout == self.sale_terms.artist_payout
                && self.listing.payment_mint == self.payment_mint.key(),
            MarketplaceError::InvalidListing
        );
        require!(
            self.payment_mint.decimals == PAYMENT_DECIMALS
                && self.payment_mint.freeze_authority.is_none()
                && self.config.payment_decimals == PAYMENT_DECIMALS,
            MarketplaceError::InvalidPaymentMint
        );
        require!(
            self.listing.condition_report == self.condition_report.key()
                && self.listing.condition_hash == self.condition_head.current_hash
                && self.listing.condition_version == self.condition_head.version
                && self.listing.custody_revision == self.custody_head.revision,
            MarketplaceError::InvalidAttestation
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
        let revision = self.listing.next_revision()?;
        let completed_sales = self
            .listing
            .completed_sales
            .checked_add(1)
            .ok_or_else(|| error!(MarketplaceError::PaymentArithmeticOverflow))?;
        self.validate_core_delegates()?;
        let source = validate_token_account(
            &self.buyer_tokens,
            self.buyer.key(),
            self.payment_mint.key(),
        )?;
        require!(
            source.amount >= self.listing.price,
            MarketplaceError::InsufficientPaymentFunds
        );
        let destinations = [
            (&self.seller_tokens, self.listing.seller),
            (&self.artist_tokens, self.listing.artist_payout),
            (&self.treasury_tokens, self.config.treasury),
        ];
        for (account, owner) in destinations {
            validate_token_account(account, owner, self.payment_mint.key())?;
            require_keys_neq!(
                account.key(),
                self.buyer_tokens.key(),
                MarketplaceError::InvalidPaymentAccount
            );
        }
        // Shared wallets must use one destination so merging cannot choose an unreviewed account.
        for (left, owner_left) in destinations {
            for (right, owner_right) in destinations {
                require!(
                    owner_left != owner_right || left.key() == right.key(),
                    MarketplaceError::InvalidPaymentAccount
                );
            }
        }
        let (commission, royalty) = if self.listing.version == 2 {
            require!(
                *self.listing_fees.owner == crate::ID
                    && self.listing_fees.data_len() == ListingFees::SPACE,
                MarketplaceError::InvalidListingFees
            );
            let data = self.listing_fees.try_borrow_data()?;
            let fees = ListingFees::try_deserialize(&mut &data[..])?;
            fees.validate(self.listing.key(), self.listing.revision)?;
            (fees.commission_bps, fees.secondary_royalty_bps)
        } else {
            (
                self.config.commission_bps,
                self.config.secondary_royalty_bps,
            )
        };
        let distribution =
            calculate_sale_distribution(self.listing.price, kind, commission, royalty)?;
        for payment in distribution.recipient_payments(
            self.listing.seller,
            self.listing.artist_payout,
            self.config.treasury,
        )? {
            let (destination, _) = destinations
                .iter()
                .find(|(_, owner)| *owner == payment.recipient)
                .ok_or_else(|| error!(MarketplaceError::InvalidPaymentRecipient))?;
            token::transfer_checked(
                CpiContext::new(
                    self.token_program.key(),
                    TransferChecked {
                        from: self.buyer_tokens.to_account_info(),
                        mint: self.payment_mint.to_account_info(),
                        to: destination.to_account_info(),
                        authority: self.buyer.to_account_info(),
                    },
                ),
                payment.amount,
                PAYMENT_DECIMALS,
            )?;
        }
        let core = self.core_program.to_account_info();
        let asset = self.asset.to_account_info();
        let collection = self.collection.to_account_info();
        let buyer = self.buyer.to_account_info();
        let listing = self.listing.to_account_info();
        let system = self.system_program.to_account_info();
        let asset_key = self.asset.key();
        let bump = [self.listing.bump];
        let seeds: &[&[u8]] = &[LISTING_SEED, asset_key.as_ref(), &bump];
        UpdatePluginV1CpiBuilder::new(&core)
            .asset(&asset)
            .collection(Some(&collection))
            .payer(&buyer)
            .authority(Some(&listing))
            .system_program(&system)
            .plugin(Plugin::FreezeDelegate(FreezeDelegate { frozen: false }))
            .invoke_signed(&[seeds])?;
        RevokePluginAuthorityV1CpiBuilder::new(&core)
            .asset(&asset)
            .collection(Some(&collection))
            .payer(&buyer)
            .authority(Some(&listing))
            .system_program(&system)
            .plugin_type(PluginType::FreezeDelegate)
            .invoke_signed(&[seeds])?;
        // Core resets the one-time Transfer Delegate to Owner during transfer.
        TransferV1CpiBuilder::new(&core)
            .asset(&asset)
            .collection(Some(&collection))
            .payer(&buyer)
            .authority(Some(&listing))
            .new_owner(&buyer)
            .system_program(Some(&system))
            .invoke_signed(&[seeds])?;
        self.listing.status = ListingStatus::Purchased;
        self.listing.revision = revision;
        self.listing.completed_sales = completed_sales;
        emit!(ArtworkPurchased {
            listing: self.listing.key(),
            artwork: self.artwork.key(),
            asset: asset_key,
            seller: self.listing.seller,
            buyer: self.buyer.key(),
            artist_payout: self.listing.artist_payout,
            treasury: self.config.treasury,
            payment_mint: self.payment_mint.key(),
            price: self.listing.price,
            seller_proceeds: distribution.seller_proceeds,
            artist_proceeds: distribution.artist_proceeds,
            treasury_fee: distribution.treasury_fee,
            sale_kind: kind,
            revision,
            completed_sales,
            condition_report: self.listing.condition_report,
            condition_hash: self.listing.condition_hash,
            condition_version: self.listing.condition_version,
            custody_revision: self.listing.custody_revision,
            purchased_at: now
        });
        Ok(())
    }

    fn validate_core_delegates(&self) -> Result<()> {
        let data = self.asset.try_borrow_data()?;
        let asset = mpl_core::Asset::from_bytes(&data)
            .map_err(|_| error!(MarketplaceError::InvalidArtwork))?;
        let freeze = asset
            .plugin_list
            .freeze_delegate
            .as_ref()
            .ok_or_else(|| error!(MarketplaceError::InvalidListingDelegates))?;
        let transfer = asset
            .plugin_list
            .transfer_delegate
            .as_ref()
            .ok_or_else(|| error!(MarketplaceError::InvalidListingDelegates))?;
        require!(
            freeze.freeze_delegate.frozen
                && freeze.base.authority.authority_type == AuthorityType::Address
                && freeze.base.authority.address == Some(self.listing.key())
                && transfer.base.authority.authority_type == AuthorityType::Address
                && transfer.base.authority.address == Some(self.listing.key()),
            MarketplaceError::InvalidListingDelegates
        );
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
        let data = self.collection.try_borrow_data()?;
        let collection = mpl_core::Collection::from_bytes(&data)
            .map_err(|_| error!(MarketplaceError::InvalidArtwork))?;
        require_keys_eq!(
            collection.base.update_authority,
            self.registry_config.collection_authority,
            MarketplaceError::InvalidArtwork
        );
        crate::listing::require_no_plugins(&data, collection.plugin_header.as_ref())
    }
}

fn validate_token_account(
    account: &UncheckedAccount,
    owner: Pubkey,
    mint: Pubkey,
) -> Result<TokenAccount> {
    let data = account.try_borrow_data()?;
    require!(
        data.len() == TokenAccount::LEN,
        MarketplaceError::InvalidPaymentAccount
    );
    let token = TokenAccount::try_deserialize(&mut &data[..])
        .map_err(|_| error!(MarketplaceError::InvalidPaymentAccount))?;
    require!(
        token.owner == owner && token.mint == mint && token.state == AccountState::Initialized,
        MarketplaceError::InvalidPaymentAccount
    );
    Ok(token)
}

#[event]
pub struct ArtworkPurchased {
    pub listing: Pubkey,
    pub artwork: Pubkey,
    pub asset: Pubkey,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub artist_payout: Pubkey,
    pub treasury: Pubkey,
    pub payment_mint: Pubkey,
    pub price: u64,
    pub seller_proceeds: u64,
    pub artist_proceeds: u64,
    pub treasury_fee: u64,
    pub sale_kind: SaleKind,
    pub revision: u64,
    pub completed_sales: u64,
    pub condition_report: Pubkey,
    pub condition_hash: [u8; 32],
    pub condition_version: u32,
    pub custody_revision: u64,
    pub purchased_at: i64,
}
