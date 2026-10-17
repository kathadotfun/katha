pub use crate::RegistryError as MultisigAuthorityError;
use crate::{program::KathaRegistry, KathaConfig, CONFIG_SEED};
use anchor_lang::prelude::*;

pub const SQUADS_PROGRAM: Pubkey = pubkey!("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");
const MULTISIG_DISCRIMINATOR: [u8; 8] = [224, 116, 121, 186, 68, 161, 79, 236];

#[derive(Accounts)]
pub struct TransferMultisigAuthority<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, KathaConfig>,
    #[account(address = config.authority @ MultisigAuthorityError::UnauthorizedAuthority)]
    pub authority: Signer<'info>,
    pub new_authority: Signer<'info>,
    /// CHECK: Exact Squads owner, discriminator, canonical PDA and bounded state checked below.
    #[account(owner = SQUADS_PROGRAM @ MultisigAuthorityError::InvalidMultisig)]
    pub multisig: UncheckedAccount<'info>,
    pub program: Program<'info, KathaRegistry>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ MultisigAuthorityError::InvalidMultisigProgramData,
        constraint = program_data.upgrade_authority_address == Some(new_authority.key()) @ MultisigAuthorityError::UpgradeAuthorityMismatch)]
    pub program_data: Account<'info, ProgramData>,
}

// Squads v4 format pinned to af94153ff77a28b6effe46b9c94baaa93742b48c,
// state/multisig.rs and sdk/multisig/src/pda.ts. Decode only bounded fields so
// its older Anchor dependency never enters Katha's Anchor 1.2.0 CPI boundary.
pub fn validate_squads_vault(
    account: &AccountInfo<'_>,
    vault: Pubkey,
    vault_index: u8,
    expected_members: [Pubkey; 3],
    expected_time_lock: u32,
) -> Result<()> {
    require_keys_eq!(
        *account.owner,
        SQUADS_PROGRAM,
        MultisigAuthorityError::InvalidMultisig
    );
    require!(!account.executable, MultisigAuthorityError::InvalidMultisig);
    let data = account.try_borrow_data()?;
    let mut reader = SquadsReader(&data);
    require!(
        reader.take::<8>()? == MULTISIG_DISCRIMINATOR,
        MultisigAuthorityError::InvalidMultisig
    );
    let create_key = Pubkey::new_from_array(reader.take::<32>()?);
    require!(
        reader.take::<32>()? == [0; 32],
        MultisigAuthorityError::ControlledMultisig
    );
    require!(
        u16::from_le_bytes(reader.take::<2>()?) == 2,
        MultisigAuthorityError::InvalidThreshold
    );
    let time_lock = u32::from_le_bytes(reader.take::<4>()?);
    require!(
        time_lock == expected_time_lock && time_lock <= 3 * 30 * 24 * 60 * 60,
        MultisigAuthorityError::UnexpectedTimeLock
    );
    let transaction_index = u64::from_le_bytes(reader.take::<8>()?);
    let stale_index = u64::from_le_bytes(reader.take::<8>()?);
    require!(
        stale_index <= transaction_index,
        MultisigAuthorityError::InvalidMultisig
    );
    match reader.take::<1>()?[0] {
        0 => (),
        1 => {
            reader.take::<32>()?;
        }
        _ => return err!(MultisigAuthorityError::InvalidMultisig),
    }
    let bump = reader.take::<1>()?[0];
    require!(
        u32::from_le_bytes(reader.take::<4>()?) == 3,
        MultisigAuthorityError::InvalidMembers
    );
    let mut members = [Pubkey::default(); 3];
    for member in &mut members {
        *member = Pubkey::new_from_array(reader.take::<32>()?);
        // All three members can initiate, vote and execute; no non-voting spare.
        require!(
            *member != Pubkey::default() && reader.take::<1>()?[0] == 7,
            MultisigAuthorityError::InvalidMembers
        );
    }
    require!(
        members == expected_members && members.windows(2).all(|pair| pair[0] < pair[1]),
        MultisigAuthorityError::InvalidMembers
    );
    let (multisig, canonical_bump) = Pubkey::find_program_address(
        &[b"multisig", b"multisig", create_key.as_ref()],
        &SQUADS_PROGRAM,
    );
    require!(
        multisig == account.key() && bump == canonical_bump,
        MultisigAuthorityError::InvalidMultisig
    );
    let (expected_vault, _) = Pubkey::find_program_address(
        &[b"multisig", multisig.as_ref(), b"vault", &[vault_index]],
        &SQUADS_PROGRAM,
    );
    require_keys_eq!(vault, expected_vault, MultisigAuthorityError::InvalidVault);
    Ok(())
}

struct SquadsReader<'a>(&'a [u8]);
impl SquadsReader<'_> {
    fn take<const N: usize>(&mut self) -> Result<[u8; N]> {
        let value = self
            .0
            .get(..N)
            .ok_or(MultisigAuthorityError::InvalidMultisig)?;
        let mut out = [0; N];
        out.copy_from_slice(value);
        self.0 = &self.0[N..];
        Ok(out)
    }
}

#[event]
pub struct MultisigAuthorityTransferred {
    pub config: Pubkey,
    pub previous_authority: Pubkey,
    pub authority: Pubkey,
    pub multisig: Pubkey,
    pub vault_index: u8,
    pub members: [Pubkey; 3],
    pub time_lock: u32,
}
