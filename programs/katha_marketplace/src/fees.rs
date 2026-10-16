use crate::*;
use anchor_lang::system_program;

pub const FEE_SCHEDULE_SEED: &[u8] = b"fee-schedule";
pub const LISTING_FEES_SEED: &[u8] = b"listing-fees";

// Separate accounts preserve the deployed config/listing layouts and historical codecs.
#[account]
pub struct FeeSchedule {
    pub version: u8,
    pub config: Pubkey,
    pub revision: u64,
    pub primary_commission_bps: u16,
    pub secondary_commission_bps: u16,
    pub secondary_royalty_bps: u16,
    pub bump: u8,
}
impl FeeSchedule {
    pub const SPACE: usize = 8 + 1 + 32 + 8 + 6 + 1;

    pub fn set_rates(&mut self, primary: u16, secondary: u16, royalty: u16) -> Result<()> {
        validate_fees(primary, 0)?;
        validate_fees(secondary, royalty)?;
        self.primary_commission_bps = primary;
        self.secondary_commission_bps = secondary;
        self.secondary_royalty_bps = royalty;
        Ok(())
    }

    pub fn changed(&self, schedule: Pubkey, collection: Pubkey, authority: Pubkey) {
        emit!(FeeScheduleChanged {
            schedule,
            config: self.config,
            collection,
            authority,
            revision: self.revision,
            primary_commission_bps: self.primary_commission_bps,
            secondary_commission_bps: self.secondary_commission_bps,
            secondary_royalty_bps: self.secondary_royalty_bps,
        });
    }
}

#[derive(Accounts)]
pub struct InitializeFeeSchedule<'info> {
    #[account(seeds = [MARKETPLACE_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MarketplaceConfig>,
    #[account(init, payer = authority, space = FeeSchedule::SPACE, seeds = [FEE_SCHEDULE_SEED], bump)]
    pub fee_schedule: Account<'info, FeeSchedule>,
    #[account(mut, address = config.authority @ MarketplaceError::UnauthorizedAuthority)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateFeeSchedule<'info> {
    #[account(seeds = [MARKETPLACE_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MarketplaceConfig>,
    #[account(mut, seeds = [FEE_SCHEDULE_SEED], bump = fee_schedule.bump,
        constraint = fee_schedule.config == config.key() && fee_schedule.version == 1 @ MarketplaceError::InvalidFeeSchedule)]
    pub fee_schedule: Account<'info, FeeSchedule>,
    #[account(address = config.authority @ MarketplaceError::UnauthorizedAuthority)]
    pub authority: Signer<'info>,
}

#[account]
pub struct ListingFees {
    pub version: u8,
    pub listing: Pubkey,
    pub listing_revision: u64,
    pub schedule_revision: u64,
    pub commission_bps: u16,
    pub secondary_royalty_bps: u16,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct CheckListingFees<'info> {
    #[account(seeds = [LISTING_SEED, listing.asset.as_ref()], bump = listing.bump)]
    pub listing: Account<'info, ListingRecord>,
    #[account(seeds = [LISTING_FEES_SEED, listing.key().as_ref()], bump = listing_fees.bump)]
    pub listing_fees: Account<'info, ListingFees>,
}
impl ListingFees {
    pub const SPACE: usize = 8 + 1 + 32 + 8 + 8 + 4 + 1;

    pub fn validate(&self, listing: Pubkey, revision: u64) -> Result<()> {
        require!(
            self.version == 1
                && self.listing == listing
                && self.listing_revision == revision
                && self.schedule_revision > 0,
            MarketplaceError::InvalidListingFees
        );
        validate_fees(self.commission_bps, self.secondary_royalty_bps)
    }
}

pub fn snapshot_listing_fees<'info>(
    account: &UncheckedAccount<'info>,
    seller: &Signer<'info>,
    listing: Pubkey,
    revision: u64,
    kind: SaleKind,
    schedule: &FeeSchedule,
    bump: u8,
) -> Result<()> {
    let bump_bytes = [bump];
    let seeds: &[&[u8]] = &[LISTING_FEES_SEED, listing.as_ref(), &bump_bytes];
    if *account.owner == system_program::ID && account.data_is_empty() {
        // Like the listing ledger, unsolicited lamports must not block allocation.
        let missing = Rent::get()?
            .minimum_balance(ListingFees::SPACE)
            .saturating_sub(account.lamports());
        if missing > 0 {
            system_program::transfer(
                CpiContext::new(
                    system_program::ID,
                    system_program::Transfer {
                        from: seller.to_account_info(),
                        to: account.to_account_info(),
                    },
                ),
                missing,
            )?;
        }
        system_program::allocate(
            CpiContext::new_with_signer(
                system_program::ID,
                system_program::Allocate {
                    account_to_allocate: account.to_account_info(),
                },
                &[seeds],
            ),
            ListingFees::SPACE as u64,
        )?;
        system_program::assign(
            CpiContext::new_with_signer(
                system_program::ID,
                system_program::Assign {
                    account_to_assign: account.to_account_info(),
                },
                &[seeds],
            ),
            &crate::ID,
        )?;
    } else {
        require!(
            *account.owner == crate::ID && account.data_len() == ListingFees::SPACE,
            MarketplaceError::InvalidListingFees
        );
        let data = account.try_borrow_data()?;
        let previous = ListingFees::try_deserialize(&mut &data[..])?;
        require!(
            previous.listing == listing
                && previous.listing_revision < revision
                && previous.bump == bump,
            MarketplaceError::InvalidListingFees
        );
    }
    let fees = ListingFees {
        version: 1,
        listing,
        listing_revision: revision,
        schedule_revision: schedule.revision,
        commission_bps: if kind == SaleKind::Primary {
            schedule.primary_commission_bps
        } else {
            schedule.secondary_commission_bps
        },
        secondary_royalty_bps: if kind == SaleKind::Primary {
            0
        } else {
            schedule.secondary_royalty_bps
        },
        bump,
    };
    fees.validate(listing, revision)?;
    fees.try_serialize(&mut &mut account.try_borrow_mut_data()?[..])
}

#[event]
pub struct FeeScheduleChanged {
    pub schedule: Pubkey,
    pub config: Pubkey,
    pub collection: Pubkey,
    pub authority: Pubkey,
    pub revision: u64,
    pub primary_commission_bps: u16,
    pub secondary_commission_bps: u16,
    pub secondary_royalty_bps: u16,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primary_and_secondary_fees_have_independent_checked_bounds() {
        let mut schedule = FeeSchedule {
            version: 1,
            config: Pubkey::new_unique(),
            revision: 1,
            primary_commission_bps: 0,
            secondary_commission_bps: 0,
            secondary_royalty_bps: 0,
            bump: 1,
        };
        for (primary, secondary, royalty) in [(1000, 250, 500), (0, 0, 0), (10000, 9500, 500)] {
            assert!(schedule.set_rates(primary, secondary, royalty).is_ok());
        }
        for (primary, secondary, royalty) in
            [(10001, 0, 0), (1000, 9501, 500), (0, u16::MAX, u16::MAX)]
        {
            assert!(schedule.set_rates(primary, secondary, royalty).is_err());
        }
    }
}
