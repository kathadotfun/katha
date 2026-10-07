use crate::{validate_fees, MarketplaceError, SaleKind, BASIS_POINTS_DENOMINATOR};
use anchor_lang::prelude::*;

#[derive(Debug, PartialEq, Eq)]
pub struct SaleDistribution {
    pub seller_proceeds: u64,
    pub artist_proceeds: u64,
    pub treasury_fee: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RecipientPayment {
    pub recipient: Pubkey,
    pub amount: u64,
}

/// Pure calculation only. The purchase instruction must supply validated listing/config values.
pub fn calculate_sale_distribution(
    price: u64,
    kind: SaleKind,
    commission_bps: u16,
    secondary_royalty_bps: u16,
) -> Result<SaleDistribution> {
    require!(price > 0, MarketplaceError::InvalidSalePrice);
    // Reject invalid configured fees even on a primary sale that charges no secondary royalty.
    validate_fees(commission_bps, secondary_royalty_bps)?;
    let treasury_fee = basis_point_amount(price, commission_bps)?;
    let after_commission = price
        .checked_sub(treasury_fee)
        .ok_or_else(|| error!(MarketplaceError::PaymentArithmeticOverflow))?;
    let (seller_proceeds, artist_proceeds) = match kind {
        SaleKind::Primary => (0, after_commission),
        SaleKind::Secondary => {
            let royalty = basis_point_amount(price, secondary_royalty_bps)?;
            let seller = after_commission
                .checked_sub(royalty)
                .ok_or_else(|| error!(MarketplaceError::PaymentArithmeticOverflow))?;
            (seller, royalty)
        }
    };
    Ok(SaleDistribution {
        seller_proceeds,
        artist_proceeds,
        treasury_fee,
    })
}

fn basis_point_amount(price: u64, bps: u16) -> Result<u64> {
    // Widen before multiplication so a valid u64 price never overflows the intermediate product.
    let amount = u128::from(price)
        .checked_mul(u128::from(bps))
        .and_then(|product| product.checked_div(u128::from(BASIS_POINTS_DENOMINATOR)))
        .ok_or_else(|| error!(MarketplaceError::PaymentArithmeticOverflow))?;
    u64::try_from(amount).map_err(|_| error!(MarketplaceError::PaymentArithmeticOverflow))
}

impl SaleDistribution {
    /// Merge amounts by payout wallet, retaining role amounts separately for sale events.
    pub fn recipient_payments(
        &self,
        seller: Pubkey,
        artist: Pubkey,
        treasury: Pubkey,
    ) -> Result<Vec<RecipientPayment>> {
        let mut payments: Vec<RecipientPayment> = Vec::with_capacity(3);
        for (recipient, amount) in [
            (seller, self.seller_proceeds),
            (artist, self.artist_proceeds),
            (treasury, self.treasury_fee),
        ] {
            require_keys_neq!(
                recipient,
                Pubkey::default(),
                MarketplaceError::InvalidPaymentRecipient
            );
            if amount == 0 {
                continue;
            }
            if let Some(payment) = payments.iter_mut().find(|p| p.recipient == recipient) {
                payment.amount = payment
                    .amount
                    .checked_add(amount)
                    .ok_or_else(|| error!(MarketplaceError::PaymentArithmeticOverflow))?;
            } else {
                payments.push(RecipientPayment { recipient, amount });
            }
        }
        Ok(payments)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_primary_and_secondary_economics() {
        assert_eq!(
            calculate_sale_distribution(100_000_000, SaleKind::Primary, 250, 500).unwrap(),
            SaleDistribution {
                seller_proceeds: 0,
                artist_proceeds: 97_500_000,
                treasury_fee: 2_500_000
            }
        );
        assert_eq!(
            calculate_sale_distribution(100_000_000, SaleKind::Secondary, 250, 500).unwrap(),
            SaleDistribution {
                seller_proceeds: 92_500_000,
                artist_proceeds: 5_000_000,
                treasury_fee: 2_500_000
            }
        );
    }

    #[test]
    fn rounding_remainder_goes_to_primary_artist_or_secondary_seller() {
        for kind in [SaleKind::Primary, SaleKind::Secondary] {
            let result = calculate_sale_distribution(1, kind, 250, 500).unwrap();
            assert_eq!(result.treasury_fee, 0);
            assert_eq!(
                result.artist_proceeds,
                if kind == SaleKind::Primary { 1 } else { 0 }
            );
            assert_eq!(
                result.seller_proceeds,
                if kind == SaleKind::Secondary { 1 } else { 0 }
            );
        }
        assert_eq!(
            calculate_sale_distribution(101, SaleKind::Secondary, 250, 500).unwrap(),
            SaleDistribution {
                seller_proceeds: 94,
                artist_proceeds: 5,
                treasury_fee: 2
            }
        );
        let result = calculate_sale_distribution(1, SaleKind::Secondary, 5000, 5000).unwrap();
        assert_eq!(result.seller_proceeds, 1);
    }

    #[test]
    fn full_u64_domain_and_zero_or_full_fees() {
        let max = u64::MAX;
        let result = calculate_sale_distribution(max, SaleKind::Secondary, 250, 500).unwrap();
        assert_eq!(result.treasury_fee, 461_168_601_842_738_790);
        assert_eq!(result.artist_proceeds, 922_337_203_685_477_580);
        assert_eq!(result.seller_proceeds, 17_063_238_268_181_335_245);
        for kind in [SaleKind::Primary, SaleKind::Secondary] {
            let result = calculate_sale_distribution(max, kind, 10_000, 0).unwrap();
            assert_eq!(
                result,
                SaleDistribution {
                    seller_proceeds: 0,
                    artist_proceeds: 0,
                    treasury_fee: max
                }
            );
            let result = calculate_sale_distribution(max, kind, 0, 0).unwrap();
            assert_eq!(result.treasury_fee, 0);
            assert_eq!(
                result.artist_proceeds,
                if kind == SaleKind::Primary { max } else { 0 }
            );
        }
        assert_eq!(
            calculate_sale_distribution(max, SaleKind::Secondary, 0, 10_000)
                .unwrap()
                .artist_proceeds,
            max
        );
    }

    #[test]
    fn invalid_prices_and_fees_fail_instead_of_underflowing() {
        for kind in [SaleKind::Primary, SaleKind::Secondary] {
            assert!(calculate_sale_distribution(0, kind, 250, 500).is_err());
            for (commission, royalty) in
                [(10_001, 0), (0, 10_001), (10_000, 1), (u16::MAX, u16::MAX)]
            {
                assert!(calculate_sale_distribution(u64::MAX, kind, commission, royalty).is_err());
            }
        }
    }

    #[test]
    fn conserve_price_for_every_fee_boundary_and_many_rounding_cases() {
        for commission in 0..=10_000 {
            for royalty in [0, 10_000 - commission] {
                for price in [1, 39, 101, 9999, 10_001, u64::MAX] {
                    for kind in [SaleKind::Primary, SaleKind::Secondary] {
                        let result =
                            calculate_sale_distribution(price, kind, commission, royalty).unwrap();
                        assert_eq!(
                            u128::from(result.seller_proceeds)
                                + u128::from(result.artist_proceeds)
                                + u128::from(result.treasury_fee),
                            u128::from(price)
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn all_recipient_overlap_patterns_merge_without_losing_role_amounts() {
        let keys = [
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
        ];
        for kind in [SaleKind::Primary, SaleKind::Secondary] {
            let distribution = calculate_sale_distribution(u64::MAX, kind, 250, 500).unwrap();
            for seller in keys {
                for artist in keys {
                    for treasury in keys {
                        let payments = distribution
                            .recipient_payments(seller, artist, treasury)
                            .unwrap();
                        assert_eq!(
                            payments.iter().map(|p| u128::from(p.amount)).sum::<u128>(),
                            u128::from(u64::MAX)
                        );
                        for key in keys {
                            let expected = (if seller == key {
                                u128::from(distribution.seller_proceeds)
                            } else {
                                0
                            }) + (if artist == key {
                                u128::from(distribution.artist_proceeds)
                            } else {
                                0
                            }) + (if treasury == key {
                                u128::from(distribution.treasury_fee)
                            } else {
                                0
                            });
                            assert_eq!(
                                payments.iter().filter(|p| p.recipient == key).count(),
                                usize::from(expected > 0)
                            );
                            assert_eq!(
                                payments
                                    .iter()
                                    .filter(|p| p.recipient == key)
                                    .map(|p| u128::from(p.amount))
                                    .sum::<u128>(),
                                expected
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn recipient_validation_zero_outputs_and_merge_overflow() {
        let key = Pubkey::new_unique();
        let distribution = calculate_sale_distribution(1, SaleKind::Primary, 0, 0).unwrap();
        assert_eq!(
            distribution.recipient_payments(key, key, key).unwrap(),
            vec![RecipientPayment {
                recipient: key,
                amount: 1
            }]
        );
        for recipients in [
            (Pubkey::default(), key, key),
            (key, Pubkey::default(), key),
            (key, key, Pubkey::default()),
        ] {
            assert!(distribution
                .recipient_payments(recipients.0, recipients.1, recipients.2)
                .is_err());
        }
        let malformed = SaleDistribution {
            seller_proceeds: u64::MAX,
            artist_proceeds: 1,
            treasury_fee: 0,
        };
        assert!(malformed.recipient_payments(key, key, key).is_err());
    }
}
