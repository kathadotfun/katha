use crate::MarketplaceError as MultisigAuthorityError;
use crate::{program::KathaMarketplace, MarketplaceConfig, MARKETPLACE_CONFIG_SEED};
use anchor_lang::prelude::*;
use katha_registry::multisig::SQUADS_PROGRAM;

#[derive(Accounts)]
pub struct TransferMultisigAuthority<'info> {
    #[account(mut, seeds = [MARKETPLACE_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MarketplaceConfig>,
    #[account(address = config.authority @ MultisigAuthorityError::UnauthorizedAuthority)]
    pub authority: Signer<'info>,
    pub new_authority: Signer<'info>,
    /// CHECK: Shared bounded Squads validation checks owner, discriminator, seeds and members.
    #[account(owner = SQUADS_PROGRAM @ MultisigAuthorityError::InvalidMultisig)]
    pub multisig: UncheckedAccount<'info>,
    pub program: Program<'info, KathaMarketplace>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ MultisigAuthorityError::InvalidMultisigProgramData,
        constraint = program_data.upgrade_authority_address == Some(new_authority.key()) @ MultisigAuthorityError::UpgradeAuthorityMismatch)]
    pub program_data: Account<'info, ProgramData>,
}

#[event]
pub struct MarketplaceMultisigAuthorityTransferred {
    pub config: Pubkey,
    pub previous_authority: Pubkey,
    pub authority: Pubkey,
    pub multisig: Pubkey,
    pub vault_index: u8,
    pub members: [Pubkey; 3],
    pub time_lock: u32,
}
