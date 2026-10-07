use crate::{MarketplaceConfig, MarketplaceError, MARKETPLACE_CONFIG_SEED};
use anchor_lang::prelude::*;
use katha_registry::{
    program::KathaRegistry, ArtworkRecord, ArtworkVerification, ConditionAttestation,
    ConditionHead, ConditionReason, CustodyHead, CustodyState, KathaConfig,
};

pub const SALE_TERMS_SEED: &[u8] = b"sale-terms";
pub const LISTING_SEED: &[u8] = b"listing";

/// Permanent economic attribution, separate from the optional creator wallet.
#[account]
pub struct ArtworkSaleTerms {
    pub version: u8,
    pub artwork: Pubkey,
    pub artist_payout: Pubkey,
    pub bump: u8,
}
impl ArtworkSaleTerms {
    pub const SPACE: usize = 8 + 1 + 32 + 32 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ListingStatus {
    Inactive,
    Active,
    Cancelled,
    Expired,
    Purchased,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum SaleKind {
    Primary,
    Secondary,
}

/// One persistent bounded ledger per asset; cancellation must preserve completed_sales.
/// No instruction creates or activates this account until the listing feature.
#[account]
pub struct ListingRecord {
    pub version: u8,
    pub config: Pubkey,
    pub artwork: Pubkey,
    pub asset: Pubkey,
    pub seller: Pubkey,
    pub artist_payout: Pubkey,
    pub payment_mint: Pubkey,
    pub condition_report: Pubkey,
    pub condition_hash: [u8; 32],
    pub condition_version: u32,
    pub custody_revision: u64,
    pub price: u64,
    pub created_at: i64,
    pub expires_at: i64,
    pub revision: u64,
    pub completed_sales: u64,
    pub sale_kind: SaleKind,
    pub status: ListingStatus,
    pub bump: u8,
}
impl ListingRecord {
    pub const SPACE: usize = 8 + 1 + 7 * 32 + 32 + 4 + 6 * 8 + 3;
    pub fn next_revision(&self) -> Result<u64> {
        self.revision
            .checked_add(1)
            .ok_or_else(|| error!(MarketplaceError::InvalidListing))
    }
}

pub fn validate_listing_terms(price: u64, expires_at: i64, now: i64) -> Result<()> {
    require!(
        price > 0 && now > 0 && expires_at > now,
        MarketplaceError::InvalidListingTerms
    );
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeSaleTerms<'info> {
    #[account(seeds = [MARKETPLACE_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MarketplaceConfig>,
    #[account(address = config.registry_program)]
    pub registry_program: Program<'info, KathaRegistry>,
    #[account(seeds = [katha_registry::ARTWORK_SEED, artwork.katha_id.as_bytes()], bump = artwork.bump,
        seeds::program = registry_program.key(), constraint = artwork.collection == config.collection @ MarketplaceError::InvalidArtwork)]
    pub artwork: Account<'info, ArtworkRecord>,
    #[account(init, payer = authority, space = ArtworkSaleTerms::SPACE, seeds = [SALE_TERMS_SEED, artwork.key().as_ref()], bump)]
    pub sale_terms: Account<'info, ArtworkSaleTerms>,
    #[account(mut, address = config.authority @ MarketplaceError::UnauthorizedAuthority)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CheckSaleEligibility<'info> {
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
    #[account(seeds = [katha_registry::CORE_ASSET_SEED, artwork.key().as_ref()], bump,
        seeds::program = registry_program.key(), owner = mpl_core::ID @ MarketplaceError::InvalidArtwork)]
    pub asset: UncheckedAccount<'info>,
    pub seller: Signer<'info>,
    /// CHECK: Canonical ledger address prevents omission of existing sale history.
    #[account(seeds = [LISTING_SEED, asset.key().as_ref()], bump)]
    pub listing_address: UncheckedAccount<'info>,
    #[account(seeds = [LISTING_SEED, asset.key().as_ref()], bump = listing.bump,
        constraint = listing.key() == listing_address.key() && listing.config == config.key() && listing.artwork == artwork.key() && listing.asset == asset.key() @ MarketplaceError::InvalidListing)]
    pub listing: Option<Box<Account<'info, ListingRecord>>>,
}

impl CheckSaleEligibility<'_> {
    pub fn validate(&self, now: i64) -> Result<()> {
        require!(
            self.config.version == 1
                && self.sale_terms.version == 1
                && self.sale_terms.artist_payout != Pubkey::default(),
            MarketplaceError::InvalidArtistPayout
        );
        require!(
            self.verification.authorship_evidence_hash == self.artwork.authorship_evidence_hash
                && self.verification.verifier == self.registry_config.verifier_authority
                && self.condition_report.verifier == self.registry_config.verifier_authority
                && self.verification.verified_at > 0
                && self.verification.verified_at <= now,
            MarketplaceError::InvalidAttestation
        );
        let data = self.asset.try_borrow_data()?;
        let asset = mpl_core::Asset::from_bytes(&data)
            .map_err(|_| error!(MarketplaceError::InvalidArtwork))?;
        require!(
            asset.base.name == self.artwork.katha_id
                && asset.base.update_authority
                    == mpl_core::types::UpdateAuthority::Collection(self.config.collection),
            MarketplaceError::InvalidArtwork
        );
        require_keys_eq!(
            asset.base.owner,
            self.seller.key(),
            MarketplaceError::UnauthorizedSeller
        );
        let kind = match &self.listing {
            Some(listing) => {
                require!(
                    listing.version == 1
                        && listing.artist_payout == self.sale_terms.artist_payout
                        && listing.payment_mint == self.config.payment_mint,
                    MarketplaceError::InvalidListing
                );
                if listing.completed_sales == 0 {
                    SaleKind::Primary
                } else {
                    SaleKind::Secondary
                }
            }
            None => {
                require!(
                    self.listing_address.data_is_empty()
                        && *self.listing_address.owner == anchor_lang::system_program::ID,
                    MarketplaceError::InvalidListing
                );
                SaleKind::Primary
            }
        };
        if kind == SaleKind::Primary {
            require_keys_eq!(
                self.seller.key(),
                self.artwork.registered_by,
                MarketplaceError::InvalidListing
            );
        }
        validate_inspection(
            &self.condition_head,
            &self.condition_report,
            &self.custody_head,
            self.seller.key(),
            self.registry_config.custody_authority,
            kind,
            self.config.inspection_validity_seconds,
            now,
        )
    }
}

pub fn validate_inspection(
    head: &ConditionHead,
    report: &ConditionAttestation,
    custody: &CustodyHead,
    seller: Pubkey,
    custody_authority: Pubkey,
    kind: SaleKind,
    validity: u64,
    now: i64,
) -> Result<()> {
    require!(
        head.version > 0
            && head.version == report.version
            && head.current_hash == report.report_hash
            && report.report_hash != [0; 32]
            && report.inspected_at > 0
            && report.inspected_at <= report.recorded_at
            && report.recorded_at <= now,
        MarketplaceError::InvalidAttestation
    );
    require!(custody.revision > 0, MarketplaceError::InvalidCustody);
    match custody.state {
        CustodyState::KathaHeld => {
            require!(
                custody.subject == Some(custody_authority),
                MarketplaceError::InvalidCustody
            );
            // Continuous Katha custody allows reuse after a digital sale. A physical
            // custody change invalidates the prior approval regardless of its age.
            let initial = report.version == 1
                && report.reason == ConditionReason::InitialVerification
                && report.owner_scope.is_none()
                && report.custody_revision_scope.is_none()
                && custody.revision == 1;
            require!(
                initial || report.custody_revision_scope == Some(custody.revision),
                MarketplaceError::InvalidInspectionScope
            );
        }
        CustodyState::CollectorHeld => {
            require!(
                custody.subject == Some(seller),
                MarketplaceError::InvalidCustody
            );
            let reason = match kind {
                SaleKind::Primary => ConditionReason::PreSale,
                SaleKind::Secondary => ConditionReason::PreResale,
            };
            require!(
                report.reason == reason
                    && report.owner_scope == Some(seller)
                    && report.custody_revision_scope == Some(custody.revision),
                MarketplaceError::InvalidInspectionScope
            );
            let age = now
                .checked_sub(report.inspected_at)
                .ok_or_else(|| error!(MarketplaceError::ExpiredInspection))?;
            require!(
                validity > 0 && validity <= i64::MAX as u64 && (age as u64) <= validity,
                MarketplaceError::ExpiredInspection
            );
        }
        _ => return err!(MarketplaceError::InvalidCustody),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use katha_registry::ConditionGrade;

    fn fixture() -> (
        ConditionHead,
        ConditionAttestation,
        CustodyHead,
        Pubkey,
        Pubkey,
    ) {
        let artwork = Pubkey::new_unique();
        let seller = Pubkey::new_unique();
        let authority = Pubkey::new_unique();
        let report_key = Pubkey::new_unique();
        (
            ConditionHead {
                artwork,
                version: 1,
                current_report: report_key,
                current_hash: [1; 32],
                bump: 1,
            },
            ConditionAttestation {
                artwork,
                version: 1,
                report_id: [1; 16],
                report_hash: [1; 32],
                grade: ConditionGrade::Good,
                reason: ConditionReason::InitialVerification,
                inspector_id: [2; 16],
                verifier: authority,
                inspected_at: 100,
                recorded_at: 101,
                owner_scope: None,
                custody_revision_scope: None,
                bump: 1,
            },
            CustodyHead {
                artwork,
                revision: 1,
                state: CustodyState::KathaHeld,
                subject: Some(authority),
                latest_transition: Pubkey::new_unique(),
                bump: 1,
            },
            seller,
            authority,
        )
    }
    #[test]
    fn continuous_katha_custody_and_physical_changes() {
        let (h, mut r, mut c, seller, authority) = fixture();
        assert!(validate_inspection(
            &h,
            &r,
            &c,
            seller,
            authority,
            SaleKind::Secondary,
            30,
            10_000
        )
        .is_ok());
        c.revision = 2;
        assert!(validate_inspection(
            &h,
            &r,
            &c,
            seller,
            authority,
            SaleKind::Secondary,
            30,
            10_000
        )
        .is_err());
        r.custody_revision_scope = Some(2);
        r.owner_scope = Some(seller);
        r.reason = ConditionReason::ReturnToCustody;
        assert!(validate_inspection(
            &h,
            &r,
            &c,
            seller,
            authority,
            SaleKind::Secondary,
            30,
            10_000
        )
        .is_ok());
        c.subject = Some(seller);
        assert!(validate_inspection(
            &h,
            &r,
            &c,
            seller,
            authority,
            SaleKind::Secondary,
            30,
            10_000
        )
        .is_err());
        for state in [CustodyState::Unknown, CustodyState::InTransit] {
            c.state = state;
            assert!(validate_inspection(
                &h,
                &r,
                &c,
                seller,
                authority,
                SaleKind::Secondary,
                30,
                10_000
            )
            .is_err());
        }
    }
    #[test]
    fn collector_approval_scope_reason_and_time_bounds() {
        let (mut h, mut r, mut c, seller, authority) = fixture();
        c.state = CustodyState::CollectorHeld;
        c.subject = Some(seller);
        c.revision = 2;
        r.reason = ConditionReason::PreResale;
        r.owner_scope = Some(seller);
        r.custody_revision_scope = Some(2);
        let check =
            |h: &ConditionHead, r: &ConditionAttestation, c: &CustodyHead, now, validity| {
                validate_inspection(
                    h,
                    r,
                    c,
                    seller,
                    authority,
                    SaleKind::Secondary,
                    validity,
                    now,
                )
            };
        assert!(check(&h, &r, &c, 130, 30).is_ok());
        assert!(check(&h, &r, &c, 131, 30).is_err());
        assert!(check(&h, &r, &c, 130, 0).is_err());
        assert!(check(&h, &r, &c, 130, u64::MAX).is_err());
        r.owner_scope = Some(Pubkey::new_unique());
        assert!(check(&h, &r, &c, 130, 30).is_err());
        r.owner_scope = Some(seller);
        r.custody_revision_scope = Some(1);
        assert!(check(&h, &r, &c, 130, 30).is_err());
        r.custody_revision_scope = Some(2);
        for reason in [
            ConditionReason::Insurance,
            ConditionReason::PreSale,
            ConditionReason::PostDelivery,
        ] {
            r.reason = reason;
            assert!(check(&h, &r, &c, 130, 30).is_err());
        }
        r.reason = ConditionReason::PreResale;
        r.inspected_at = 131;
        assert!(check(&h, &r, &c, 130, 30).is_err());
        r.inspected_at = 100;
        h.current_hash = [2; 32];
        assert!(check(&h, &r, &c, 130, 30).is_err());
        h.current_hash = r.report_hash;
        h.version = 2;
        assert!(check(&h, &r, &c, 130, 30).is_err());
    }
    #[test]
    fn bounded_listing_layout_and_price_expiry() {
        let key = Pubkey::new_unique();
        let listing = ListingRecord {
            version: 1,
            config: key,
            artwork: key,
            asset: key,
            seller: key,
            artist_payout: key,
            payment_mint: key,
            condition_report: key,
            condition_hash: [1; 32],
            condition_version: 1,
            custody_revision: 1,
            price: u64::MAX,
            created_at: 1,
            expires_at: 2,
            revision: 1,
            completed_sales: 0,
            sale_kind: SaleKind::Primary,
            status: ListingStatus::Inactive,
            bump: 1,
        };
        let mut bytes = Vec::new();
        listing.try_serialize(&mut bytes).unwrap();
        assert_eq!(bytes.len(), ListingRecord::SPACE);
        assert_eq!(listing.next_revision().unwrap(), 2);
        let mut listing = listing;
        listing.revision = u64::MAX;
        assert!(listing.next_revision().is_err());
        assert!(validate_listing_terms(u64::MAX, 2, 1).is_ok());
        for (price, expiry, now) in [(0, 2, 1), (1, 1, 1), (1, 0, 1), (1, 2, 0), (1, i64::MIN, 1)] {
            assert!(validate_listing_terms(price, expiry, now).is_err());
        }
    }
}
