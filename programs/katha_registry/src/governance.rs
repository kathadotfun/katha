use crate::{KathaConfig, RegistryError, CONFIG_SEED};
use anchor_lang::prelude::*;

pub const GOVERNANCE_SEED: &[u8] = b"governance";
pub const ROLE_GRANT_SEED: &[u8] = b"role-grant";
pub const CATALOG: u16 = 1;
pub const ARTIST_VERIFIER: u16 = 2;
pub const REGISTRAR: u16 = 4;
pub const ARTWORK_VERIFIER: u16 = 8;
pub const CUSTODY: u16 = 16;
pub const INVENTORY_SALES: u16 = 32;
pub const GUARDIAN: u16 = 64;
pub const ALL_ROLES: u16 = 127;
pub const PAUSE_REGISTRY: u8 = 1;
pub const PAUSE_LISTINGS: u8 = 2;
pub const PAUSE_PURCHASES: u8 = 4;
pub const ALL_PAUSES: u8 = 7;
// Bounded incident set. A full set fails closed; pausing remains available.
pub const MAX_HOLDS: usize = 64;

#[account]
pub struct RegistryGovernance {
    pub version: u8,
    pub config: Pubkey,
    pub marketplace_program: Pubkey,
    pub marketplace_config: Pubkey,
    pub legacy_registrar: Pubkey,
    pub custody_identity: Pubkey,
    pub revision: u64,
    pub pauses: u8,
    pub holds: Vec<ArtworkIncident>,
    pub bump: u8,
}
impl RegistryGovernance {
    pub const SPACE: usize = 8 + 1 + 5 * 32 + 8 + 1 + 4 + (32 + 4 + 8 + 32) * MAX_HOLDS + 1;
    pub fn check(&self, pause: u8, artwork: Option<Pubkey>) -> Result<()> {
        require!(
            self.version == 1 && self.pauses & pause == 0,
            RegistryError::GovernancePaused
        );
        if let Some(key) = artwork {
            require!(
                !self.holds.iter().any(|hold| hold.artwork == key),
                RegistryError::ArtworkOnHold
            );
        }
        Ok(())
    }
    pub fn advance(&mut self, expected: u64) -> Result<()> {
        require!(self.revision == expected, RegistryError::StaleGovernance);
        self.revision = self
            .revision
            .checked_add(1)
            .ok_or(RegistryError::StaleGovernance)?;
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ArtworkIncident {
    pub artwork: Pubkey,
    pub condition_version: u32,
    pub placed_at: i64,
    pub reason_hash: [u8; 32],
}

#[account]
pub struct RoleGrant {
    pub version: u8,
    pub governance: Pubkey,
    pub wallet: Pubkey,
    pub roles: u16,
    pub enabled: bool,
    /// Zero means no expiry; otherwise Unix time, with equality already expired.
    pub expires_at: i64,
    pub revision: u64,
    pub changed_by: Pubkey,
    pub changed_at: i64,
    pub changed_slot: u64,
    pub bump: u8,
}
impl RoleGrant {
    pub const SPACE: usize = 8 + 1 + 32 * 3 + 2 + 1 + 8 * 4 + 1;
    pub fn permits(&self, wallet: Pubkey, role: u16, now: i64) -> bool {
        self.version == 1
            && self.wallet == wallet
            && self.enabled
            && self.roles != 0
            && self.roles & !ALL_ROLES == 0
            && self.roles & role == role
            && (self.expires_at == 0 || self.expires_at > now)
    }
}

pub fn governance_address() -> Pubkey {
    Pubkey::find_program_address(&[GOVERNANCE_SEED], &crate::ID).0
}
pub fn is_governed(config: &KathaConfig) -> bool {
    config.registration_authority == governance_address()
}

/// The irreversible config marker prevents callers omitting accounts to revive old wallets.
pub fn read_governance(
    config: &KathaConfig,
    remaining: &[AccountInfo],
) -> Result<Option<RegistryGovernance>> {
    if !is_governed(config) {
        return Ok(None);
    }
    let info = remaining.first().ok_or(RegistryError::InvalidGovernance)?;
    require_keys_eq!(
        info.key(),
        governance_address(),
        RegistryError::InvalidGovernance
    );
    require_keys_eq!(*info.owner, crate::ID, RegistryError::InvalidGovernance);
    require!(
        !info.executable && info.data_len() == RegistryGovernance::SPACE,
        RegistryError::InvalidGovernance
    );
    let governance = RegistryGovernance::try_deserialize(&mut info.try_borrow_data()?.as_ref())?;
    let (config_key, _) = Pubkey::find_program_address(&[CONFIG_SEED], &crate::ID);
    require!(
        governance.version == 1
            && governance.config == config_key
            && governance.holds.len() <= MAX_HOLDS
            && governance.pauses & !ALL_PAUSES == 0,
        RegistryError::InvalidGovernance
    );
    Ok(Some(governance))
}

pub fn read_grant(governance: Pubkey, wallet: Pubkey, info: &AccountInfo) -> Result<RoleGrant> {
    let expected = Pubkey::find_program_address(&[ROLE_GRANT_SEED, wallet.as_ref()], &crate::ID).0;
    require_keys_eq!(info.key(), expected, RegistryError::InvalidRoleGrant);
    require_keys_eq!(*info.owner, crate::ID, RegistryError::InvalidRoleGrant);
    require!(
        !info.executable && info.data_len() == RoleGrant::SPACE,
        RegistryError::InvalidRoleGrant
    );
    let grant = RoleGrant::try_deserialize(&mut info.try_borrow_data()?.as_ref())?;
    require!(
        grant.governance == governance && grant.wallet == wallet,
        RegistryError::InvalidRoleGrant
    );
    Ok(grant)
}

pub fn authorize_operator(
    config: &KathaConfig,
    wallet: Pubkey,
    role: u16,
    artwork: Option<Pubkey>,
    remaining: &[AccountInfo],
) -> Result<()> {
    if let Some(governance) = read_governance(config, remaining)? {
        governance.check(
            PAUSE_REGISTRY,
            if role == REGISTRAR { artwork } else { None },
        )?;
        let grant = read_grant(
            governance_address(),
            wallet,
            remaining.get(1).ok_or(RegistryError::InvalidRoleGrant)?,
        )?;
        require!(
            grant.permits(wallet, role, Clock::get()?.unix_timestamp),
            RegistryError::UnauthorizedOperator
        );
    } else {
        let expected = match role {
            REGISTRAR => config.registration_authority,
            ARTWORK_VERIFIER => config.verifier_authority,
            CUSTODY => config.custody_authority,
            _ => return err!(RegistryError::UnauthorizedOperator),
        };
        require_keys_eq!(wallet, expected, RegistryError::UnauthorizedOperator);
    }
    Ok(())
}

#[derive(Accounts)]
pub struct ActivateGovernance<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, KathaConfig>,
    #[account(init, payer = payer, space = RegistryGovernance::SPACE, seeds = [GOVERNANCE_SEED], bump)]
    pub governance: Account<'info, RegistryGovernance>,
    #[account(address = config.authority @ RegistryError::UnauthorizedAuthority)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Parsed as the canonical autonomous two-of-three Squads account.
    pub multisig: UncheckedAccount<'info>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ RegistryError::InvalidProgramData)]
    pub program: Program<'info, crate::program::KathaRegistry>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ RegistryError::UpgradeAuthorityMismatch)]
    pub program_data: Account<'info, ProgramData>,
    /// CHECK: An executable loader-v3 program with its canonical ProgramData below.
    #[account(executable, address = crate::MARKETPLACE_PROGRAM_ID @ RegistryError::InvalidGovernance,
        owner = anchor_lang::solana_program::bpf_loader_upgradeable::ID)]
    pub marketplace_program: UncheckedAccount<'info>,
    #[account(constraint = marketplace_program_data.upgrade_authority_address == Some(authority.key()) @ RegistryError::UpgradeAuthorityMismatch)]
    pub marketplace_program_data: Account<'info, ProgramData>,
    /// CHECK: Handler checks canonical PDA, owner, discriminator and both program/config roots.
    pub marketplace_config: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct CreateRoleGrant<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, KathaConfig>,
    #[account(seeds = [GOVERNANCE_SEED], bump = governance.bump, constraint = is_governed(&config) && governance.config == config.key() @ RegistryError::InvalidGovernance)]
    pub governance: Account<'info, RegistryGovernance>,
    #[account(init, payer = payer, space = RoleGrant::SPACE, seeds = [ROLE_GRANT_SEED, wallet.as_ref()], bump)]
    pub grant: Account<'info, RoleGrant>,
    #[account(address = config.authority @ RegistryError::UnauthorizedAuthority)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateRoleGrant<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, KathaConfig>,
    #[account(seeds = [GOVERNANCE_SEED], bump = governance.bump, constraint = is_governed(&config) && governance.config == config.key() @ RegistryError::InvalidGovernance)]
    pub governance: Account<'info, RegistryGovernance>,
    #[account(mut, seeds = [ROLE_GRANT_SEED, grant.wallet.as_ref()], bump = grant.bump, constraint = grant.governance == governance.key() @ RegistryError::InvalidRoleGrant)]
    pub grant: Account<'info, RoleGrant>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetGovernancePause<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, KathaConfig>,
    #[account(mut, seeds = [GOVERNANCE_SEED], bump = governance.bump, constraint = is_governed(&config) && governance.config == config.key() @ RegistryError::InvalidGovernance)]
    pub governance: Account<'info, RegistryGovernance>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetArtworkHold<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, KathaConfig>,
    #[account(mut, seeds = [GOVERNANCE_SEED], bump = governance.bump, constraint = is_governed(&config) && governance.config == config.key() @ RegistryError::InvalidGovernance)]
    pub governance: Account<'info, RegistryGovernance>,
    #[account(seeds = [crate::ARTWORK_SEED, artwork.katha_id.as_bytes()], bump = artwork.bump, constraint = artwork.collection == config.collection @ RegistryError::InvalidArtworkCollection)]
    pub artwork: Account<'info, crate::ArtworkRecord>,
    /// CHECK: Canonical address; handler distinguishes absent head from a Registry condition head.
    #[account(seeds = [crate::CONDITION_HEAD_SEED, artwork.key().as_ref()], bump)]
    pub head: UncheckedAccount<'info>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClearArtworkHold<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, KathaConfig>,
    #[account(mut, seeds = [GOVERNANCE_SEED], bump = governance.bump, constraint = is_governed(&config) && governance.config == config.key() @ RegistryError::InvalidGovernance)]
    pub governance: Account<'info, RegistryGovernance>,
    #[account(seeds = [crate::ARTWORK_SEED, artwork.katha_id.as_bytes()], bump = artwork.bump, constraint = artwork.collection == config.collection @ RegistryError::InvalidArtworkCollection)]
    pub artwork: Account<'info, crate::ArtworkRecord>,
    #[account(seeds = [crate::CONDITION_HEAD_SEED, artwork.key().as_ref()], bump = head.bump,
        constraint = head.artwork == artwork.key() && head.current_report == condition_report.key() @ RegistryError::InvalidConditionRelationship)]
    pub head: Account<'info, crate::ConditionHead>,
    #[account(seeds = [crate::CONDITION_REPORT_SEED, &condition_report.report_id], bump = condition_report.bump,
        constraint = condition_report.artwork == artwork.key() && condition_report.version == head.version
            && condition_report.report_hash == head.current_hash @ RegistryError::InvalidConditionRelationship)]
    pub condition_report: Account<'info, crate::ConditionAttestation>,
    #[account(address = config.authority @ RegistryError::UnauthorizedAuthority)]
    pub authority: Signer<'info>,
}

pub fn require_root_or_guardian(
    config: &KathaConfig,
    authority: Pubkey,
    remaining: &[AccountInfo],
) -> Result<bool> {
    if authority == config.authority {
        return Ok(true);
    }
    let grant = read_grant(
        governance_address(),
        authority,
        remaining.first().ok_or(RegistryError::InvalidRoleGrant)?,
    )?;
    require!(
        grant.permits(authority, GUARDIAN, Clock::get()?.unix_timestamp),
        RegistryError::UnauthorizedOperator
    );
    Ok(false)
}

pub fn write_grant(
    grant: &mut RoleGrant,
    roles: u16,
    enabled: bool,
    expires_at: i64,
    actor: Pubkey,
) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        roles != 0
            && roles & !ALL_ROLES == 0
            && expires_at >= 0
            && (!enabled || expires_at == 0 || expires_at > clock.unix_timestamp),
        RegistryError::InvalidRoleGrant
    );
    grant.roles = roles;
    grant.enabled = enabled;
    grant.expires_at = expires_at;
    grant.changed_by = actor;
    grant.changed_at = clock.unix_timestamp;
    grant.changed_slot = clock.slot;
    grant.revision = grant
        .revision
        .checked_add(1)
        .ok_or(RegistryError::StaleGovernance)?;
    Ok(())
}
