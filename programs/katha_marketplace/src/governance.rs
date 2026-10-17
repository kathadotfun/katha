use crate::{MarketplaceConfig, MarketplaceError, MARKETPLACE_CONFIG_SEED};
use anchor_lang::prelude::*;
use katha_registry::{governance::read_governance, KathaConfig};

/// Version two is an irreversible staging marker. Risk-creating calls require the
/// canonical Registry governance, including while activation is incomplete.
pub fn check_governance(
    config: &MarketplaceConfig,
    registry: &KathaConfig,
    remaining: &[AccountInfo],
    pause: u8,
    artwork: Option<Pubkey>,
) -> Result<()> {
    if config.version == 1 {
        return Ok(());
    }
    require!(
        config.version == 2 && config.authority == registry.authority,
        MarketplaceError::InvalidGovernance
    );
    let governance = read_governance(registry, remaining)
        .map_err(|_| error!(MarketplaceError::InvalidGovernance))?
        .ok_or(MarketplaceError::InvalidGovernance)?;
    require!(
        governance.marketplace_program == crate::ID
            && governance.marketplace_config
                == Pubkey::find_program_address(&[MARKETPLACE_CONFIG_SEED], &crate::ID).0,
        MarketplaceError::InvalidGovernance
    );
    governance
        .check(pause, artwork)
        .map_err(|_| error!(MarketplaceError::GovernancePaused))
}

pub fn check_root_governance(config: &MarketplaceConfig, remaining: &[AccountInfo]) -> Result<()> {
    if config.version == 1 {
        return Ok(());
    }
    let info = remaining
        .get(2)
        .ok_or(MarketplaceError::InvalidGovernance)?;
    require_keys_eq!(
        info.key(),
        config.registry_config,
        MarketplaceError::InvalidGovernance
    );
    require_keys_eq!(
        *info.owner,
        katha_registry::ID,
        MarketplaceError::InvalidGovernance
    );
    require!(
        !info.executable && info.data_len() == KathaConfig::SPACE,
        MarketplaceError::InvalidGovernance
    );
    let registry = KathaConfig::try_deserialize(&mut info.try_borrow_data()?.as_ref())?;
    check_governance(
        config,
        &registry,
        remaining,
        katha_registry::governance::PAUSE_REGISTRY,
        None,
    )
}

#[derive(Accounts)]
pub struct StageGovernance<'info> {
    #[account(mut, seeds = [MARKETPLACE_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, MarketplaceConfig>,
    #[account(address = config.authority @ MarketplaceError::UnauthorizedAuthority)]
    pub authority: Signer<'info>,
    #[account(address = config.registry_config, seeds = [katha_registry::CONFIG_SEED], bump = registry_config.bump, seeds::program = katha_registry::ID,
        constraint = registry_config.authority == authority.key() @ MarketplaceError::UnauthorizedAuthority)]
    pub registry_config: Account<'info, KathaConfig>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ MarketplaceError::InvalidProgramData)]
    pub program: Program<'info, crate::program::KathaMarketplace>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ MarketplaceError::UpgradeAuthorityMismatch)]
    pub program_data: Account<'info, ProgramData>,
}
