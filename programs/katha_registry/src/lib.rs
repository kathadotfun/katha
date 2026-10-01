use anchor_lang::prelude::*;

declare_id!("5829CUnLsucsi3Tj7573LYV5gNQo35ztGhdY4yhNoAkC");

pub const CONFIG_SEED: &[u8] = b"katha-config";
pub const COLLECTION_AUTHORITY_SEED: &[u8] = b"collection-authority";
pub const ARTWORK_SEED: &[u8] = b"artwork";
pub const VERIFICATION_SEED: &[u8] = b"verification";
pub const METADATA_HEAD_SEED: &[u8] = b"metadata";
pub const METADATA_VERSION_SEED: &[u8] = b"metadata-version";
pub const CONDITION_HEAD_SEED: &[u8] = b"condition";
pub const CONDITION_REPORT_SEED: &[u8] = b"condition-report";
pub const CUSTODY_HEAD_SEED: &[u8] = b"custody";
pub const CUSTODY_TRANSITION_SEED: &[u8] = b"custody-transition";

#[program]
pub mod katha_registry {
    use super::*;

    pub fn initialize_platform(
        ctx: Context<InitializePlatform>,
        registration_authority: Pubkey,
        verifier_authority: Pubkey,
        custody_authority: Pubkey,
        treasury: Pubkey,
    ) -> Result<()> {
        for role in [
            registration_authority,
            verifier_authority,
            custody_authority,
            treasury,
        ] {
            require_keys_neq!(role, Pubkey::default(), RegistryError::InvalidRole);
        }

        let collection_data = ctx.accounts.collection.try_borrow_data()?;
        let collection = mpl_core::Collection::from_bytes(&collection_data)
            .map_err(|_| error!(RegistryError::InvalidCollection))?;
        require_keys_eq!(
            collection.base.update_authority,
            ctx.accounts.collection_authority.key(),
            RegistryError::InvalidCollectionAuthority
        );
        // Bootstrap only a fresh, plain collection; plugins could grant bypass authority.
        require!(
            collection.base.num_minted == 0
                && collection.base.current_size == 0
                && collection.plugin_header.is_none(),
            RegistryError::InvalidCollection
        );

        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.bootstrap_authority.key();
        config.registration_authority = registration_authority;
        config.verifier_authority = verifier_authority;
        config.custody_authority = custody_authority;
        config.treasury = treasury;
        config.collection = ctx.accounts.collection.key();
        config.collection_authority = ctx.accounts.collection_authority.key();
        config.bump = ctx.bumps.config;
        config.collection_authority_bump = ctx.bumps.collection_authority;

        emit!(PlatformInitialized {
            config: config.key(),
            authority: config.authority,
            collection: config.collection,
            registration_authority,
            verifier_authority,
            custody_authority,
            treasury,
        });
        Ok(())
    }

    pub fn register_artwork(
        ctx: Context<RegisterArtwork>,
        katha_id: String,
        artist_id: String,
        creator_wallet: Option<Pubkey>,
        category: ArtworkCategory,
        creation_year: u16,
        authorship_evidence_hash: [u8; 32],
    ) -> Result<()> {
        let serial = katha_id
            .strip_prefix(category.id_prefix())
            .ok_or(RegistryError::InvalidArtworkId)?;
        require!(
            serial.len() == 6
                && serial.bytes().all(|byte| byte.is_ascii_digit())
                && serial != "000000",
            RegistryError::InvalidArtworkId
        );
        let uuid = artist_id.as_bytes();
        require!(
            uuid.len() == 36
                && uuid.iter().enumerate().all(|(index, byte)| match index {
                    8 | 13 | 18 | 23 => *byte == b'-',
                    _ => byte.is_ascii_digit() || (b'a'..=b'f').contains(byte),
                })
                && (b'1'..=b'8').contains(&uuid[14])
                && (b'8'..=b'b').contains(&uuid[19]),
            RegistryError::InvalidArtistId
        );
        require!(
            (1..=9999).contains(&creation_year),
            RegistryError::InvalidCreationYear
        );
        require!(
            authorship_evidence_hash != [0; 32],
            RegistryError::InvalidAuthorshipHash
        );
        if let Some(wallet) = creator_wallet {
            require_keys_neq!(
                wallet,
                Pubkey::default(),
                RegistryError::InvalidCreatorWallet
            );
        }

        let artwork = &mut ctx.accounts.artwork;
        artwork.katha_id = katha_id;
        artwork.artist_id = artist_id;
        artwork.creator_wallet = creator_wallet;
        artwork.category = category;
        artwork.creation_year = creation_year;
        artwork.authorship_evidence_hash = authorship_evidence_hash;
        artwork.collection = ctx.accounts.config.collection;
        artwork.core_asset = None;
        artwork.registered_by = ctx.accounts.registration_authority.key();
        artwork.registered_at = Clock::get()?.unix_timestamp;
        artwork.bump = ctx.bumps.artwork;

        emit!(ArtworkRegistered {
            artwork: artwork.key(),
            katha_id: artwork.katha_id.clone(),
            artist_id: artwork.artist_id.clone(),
            creator_wallet,
            category,
            creation_year,
            authorship_evidence_hash,
            collection: artwork.collection,
            registered_by: artwork.registered_by,
            registered_at: artwork.registered_at,
        });
        Ok(())
    }

    pub fn verify_artwork(
        ctx: Context<VerifyArtwork>,
        expected_authorship_evidence_hash: [u8; 32],
    ) -> Result<()> {
        let artwork = &ctx.accounts.artwork;
        require!(
            expected_authorship_evidence_hash == artwork.authorship_evidence_hash,
            RegistryError::AuthorshipHashMismatch
        );

        let verification = &mut ctx.accounts.verification;
        verification.artwork = artwork.key();
        verification.authorship_evidence_hash = artwork.authorship_evidence_hash;
        verification.verifier = ctx.accounts.verifier_authority.key();
        verification.verified_at = Clock::get()?.unix_timestamp;
        verification.bump = ctx.bumps.verification;

        emit!(ArtworkVerified {
            artwork: artwork.key(),
            katha_id: artwork.katha_id.clone(),
            authorship_evidence_hash: verification.authorship_evidence_hash,
            verifier: verification.verifier,
            verified_at: verification.verified_at,
        });
        Ok(())
    }

    pub fn initialize_metadata(
        ctx: Context<InitializeMetadata>,
        document_hash: [u8; 32],
        uri: String,
    ) -> Result<()> {
        validate_metadata_commitment(&document_hash, &uri)?;
        let artwork = &ctx.accounts.artwork;
        let revision = &mut ctx.accounts.revision;
        revision.artwork = artwork.key();
        revision.version = 1;
        revision.document_hash = document_hash;
        revision.uri = uri;
        revision.committed_by = ctx.accounts.registration_authority.key();
        revision.committed_at = Clock::get()?.unix_timestamp;
        revision.bump = ctx.bumps.revision;

        let head = &mut ctx.accounts.head;
        head.artwork = artwork.key();
        head.version = revision.version;
        head.current_revision = revision.key();
        head.current_hash = document_hash;
        head.bump = ctx.bumps.head;

        emit!(MetadataCommitted {
            artwork: artwork.key(),
            katha_id: artwork.katha_id.clone(),
            revision: revision.key(),
            version: revision.version,
            document_hash,
            committed_by: revision.committed_by,
            committed_at: revision.committed_at,
        });
        Ok(())
    }

    pub fn revise_unminted_metadata(
        ctx: Context<ReviseUnmintedMetadata>,
        expected_version: u32,
        next_version: u32,
        document_hash: [u8; 32],
        uri: String,
    ) -> Result<()> {
        let head = &mut ctx.accounts.head;
        require!(
            head.version == expected_version,
            RegistryError::StaleMetadataVersion
        );
        require!(
            expected_version.checked_add(1) == Some(next_version),
            RegistryError::InvalidMetadataVersion
        );
        validate_metadata_commitment(&document_hash, &uri)?;

        let artwork = &ctx.accounts.artwork;
        let revision = &mut ctx.accounts.revision;
        revision.artwork = artwork.key();
        revision.version = next_version;
        revision.document_hash = document_hash;
        revision.uri = uri;
        revision.committed_by = ctx.accounts.registration_authority.key();
        revision.committed_at = Clock::get()?.unix_timestamp;
        revision.bump = ctx.bumps.revision;

        head.version = next_version;
        head.current_revision = revision.key();
        head.current_hash = document_hash;

        emit!(MetadataCommitted {
            artwork: artwork.key(),
            katha_id: artwork.katha_id.clone(),
            revision: revision.key(),
            version: revision.version,
            document_hash,
            committed_by: revision.committed_by,
            committed_at: revision.committed_at,
        });
        Ok(())
    }

    pub fn initialize_condition(
        ctx: Context<InitializeCondition>,
        report_id: [u8; 16],
        report_hash: [u8; 32],
        grade: ConditionGrade,
        reason: ConditionReason,
        inspector_id: [u8; 16],
        inspected_at: i64,
    ) -> Result<()> {
        require!(
            reason == ConditionReason::InitialVerification,
            RegistryError::InvalidInitialConditionReason
        );
        let recorded_at = Clock::get()?.unix_timestamp;
        validate_condition_report(
            &report_id,
            &report_hash,
            &inspector_id,
            inspected_at,
            recorded_at,
        )?;
        let artwork = &ctx.accounts.artwork;
        let report = &mut ctx.accounts.report;
        report.artwork = artwork.key();
        report.version = 1;
        report.report_id = report_id;
        report.report_hash = report_hash;
        report.grade = grade;
        report.reason = reason;
        report.inspector_id = inspector_id;
        report.verifier = ctx.accounts.verifier_authority.key();
        report.inspected_at = inspected_at;
        report.recorded_at = recorded_at;
        report.owner_scope = None;
        report.custody_revision_scope = None;
        report.bump = ctx.bumps.report;

        let head = &mut ctx.accounts.head;
        head.artwork = artwork.key();
        head.version = report.version;
        head.current_report = report.key();
        head.current_hash = report_hash;
        head.bump = ctx.bumps.head;

        emit!(ConditionRecorded {
            artwork: artwork.key(),
            katha_id: artwork.katha_id.clone(),
            report: report.key(),
            report_id,
            version: report.version,
            report_hash,
            grade,
            reason,
            inspector_id,
            verifier: report.verifier,
            inspected_at,
            recorded_at,
            owner_scope: None,
            custody_revision_scope: None,
        });
        Ok(())
    }

    pub fn record_unminted_condition(
        ctx: Context<RecordUnmintedCondition>,
        expected_version: u32,
        next_version: u32,
        report_id: [u8; 16],
        report_hash: [u8; 32],
        grade: ConditionGrade,
        reason: ConditionReason,
        inspector_id: [u8; 16],
        inspected_at: i64,
    ) -> Result<()> {
        let head = &mut ctx.accounts.head;
        require!(
            head.version == expected_version,
            RegistryError::StaleConditionVersion
        );
        require!(
            expected_version.checked_add(1) == Some(next_version),
            RegistryError::InvalidConditionVersion
        );
        require!(
            matches!(
                reason,
                ConditionReason::PreSale | ConditionReason::Insurance
            ),
            RegistryError::InvalidUnmintedConditionReason
        );
        let recorded_at = Clock::get()?.unix_timestamp;
        validate_condition_report(
            &report_id,
            &report_hash,
            &inspector_id,
            inspected_at,
            recorded_at,
        )?;

        let artwork = &ctx.accounts.artwork;
        let report = &mut ctx.accounts.report;
        report.artwork = artwork.key();
        report.version = next_version;
        report.report_id = report_id;
        report.report_hash = report_hash;
        report.grade = grade;
        report.reason = reason;
        report.inspector_id = inspector_id;
        report.verifier = ctx.accounts.verifier_authority.key();
        report.inspected_at = inspected_at;
        report.recorded_at = recorded_at;
        report.owner_scope = None;
        report.custody_revision_scope = None;
        report.bump = ctx.bumps.report;

        head.version = next_version;
        head.current_report = report.key();
        head.current_hash = report_hash;

        emit!(ConditionRecorded {
            artwork: artwork.key(),
            katha_id: artwork.katha_id.clone(),
            report: report.key(),
            report_id,
            version: report.version,
            report_hash,
            grade,
            reason,
            inspector_id,
            verifier: report.verifier,
            inspected_at,
            recorded_at,
            owner_scope: None,
            custody_revision_scope: None,
        });
        Ok(())
    }

    pub fn initialize_custody(
        ctx: Context<InitializeCustody>,
        action: CustodyAction,
        collector: Option<Pubkey>,
    ) -> Result<()> {
        let artwork = &ctx.accounts.artwork;
        let authority = ctx.accounts.custody_authority.key();
        let (state, subject) =
            custody_destination(action, CustodyState::Unknown, collector, authority)?;
        let recorded_at = Clock::get()?.unix_timestamp;
        let transition = &mut ctx.accounts.transition;
        transition.artwork = artwork.key();
        transition.revision = 1;
        transition.action = action;
        transition.from_state = CustodyState::Unknown;
        transition.to_state = state;
        transition.from_subject = None;
        transition.to_subject = subject;
        transition.attested_by = authority;
        transition.recorded_at = recorded_at;
        transition.bump = ctx.bumps.transition;

        let head = &mut ctx.accounts.head;
        head.artwork = artwork.key();
        head.revision = 1;
        head.state = state;
        head.subject = subject;
        head.latest_transition = transition.key();
        head.bump = ctx.bumps.head;

        emit!(CustodyUpdated {
            artwork: artwork.key(),
            katha_id: artwork.katha_id.clone(),
            transition: transition.key(),
            revision: 1,
            action,
            from_state: CustodyState::Unknown,
            to_state: state,
            from_subject: None,
            to_subject: subject,
            attested_by: authority,
            recorded_at,
        });
        Ok(())
    }

    pub fn transition_custody(
        ctx: Context<TransitionCustody>,
        expected_revision: u64,
        next_revision: u64,
        action: CustodyAction,
        collector: Option<Pubkey>,
    ) -> Result<()> {
        let head = &mut ctx.accounts.head;
        require!(
            head.revision == expected_revision,
            RegistryError::StaleCustodyRevision
        );
        require!(
            expected_revision.checked_add(1) == Some(next_revision),
            RegistryError::InvalidCustodyRevision
        );
        let from_state = head.state;
        let from_subject = head.subject;
        let artwork = &ctx.accounts.artwork;
        let authority = ctx.accounts.custody_authority.key();
        let (state, subject) = custody_destination(action, from_state, collector, authority)?;
        let recorded_at = Clock::get()?.unix_timestamp;

        let transition = &mut ctx.accounts.transition;
        transition.artwork = artwork.key();
        transition.revision = next_revision;
        transition.action = action;
        transition.from_state = from_state;
        transition.to_state = state;
        transition.from_subject = from_subject;
        transition.to_subject = subject;
        transition.attested_by = authority;
        transition.recorded_at = recorded_at;
        transition.bump = ctx.bumps.transition;

        head.revision = next_revision;
        head.state = state;
        head.subject = subject;
        head.latest_transition = transition.key();

        emit!(CustodyUpdated {
            artwork: artwork.key(),
            katha_id: artwork.katha_id.clone(),
            transition: transition.key(),
            revision: next_revision,
            action,
            from_state,
            to_state: state,
            from_subject,
            to_subject: subject,
            attested_by: authority,
            recorded_at,
        });
        Ok(())
    }

    // Compiled only into the local harness binary, never the normal Registry build.
    #[cfg(feature = "core-cpi-test")]
    pub fn probe_create_core_collection(
        ctx: Context<CoreCpiProbe>,
        name: String,
        uri: String,
    ) -> Result<()> {
        use mpl_core::instructions::CreateCollectionV2CpiBuilder;

        CreateCollectionV2CpiBuilder::new(&ctx.accounts.core_program.to_account_info())
            .collection(&ctx.accounts.collection.to_account_info())
            .update_authority(Some(&ctx.accounts.update_authority.to_account_info()))
            .payer(&ctx.accounts.payer.to_account_info())
            .system_program(&ctx.accounts.system_program.to_account_info())
            .name(name)
            .uri(uri)
            .invoke()?;
        Ok(())
    }
}

fn validate_metadata_commitment(document_hash: &[u8; 32], uri: &str) -> Result<()> {
    require!(
        *document_hash != [0; 32],
        RegistryError::InvalidMetadataHash
    );
    let authority = uri
        .split_once("://")
        .filter(|(scheme, _)| *scheme == "https" || *scheme == "http")
        .map(|(_, rest)| rest.split(['/', '?']).next().unwrap_or_default())
        .unwrap_or_default();
    require!(
        uri.len() <= 200
            && !authority.is_empty()
            && authority
                .bytes()
                .next()
                .is_some_and(|byte| byte.is_ascii_alphanumeric())
            && uri
                .bytes()
                .all(|byte| byte.is_ascii_graphic() && byte != b'@' && byte != b'#'),
        RegistryError::InvalidMetadataUri
    );
    Ok(())
}

fn valid_uuid_bytes(id: &[u8; 16]) -> bool {
    let version = id[6] >> 4;
    (1..=8).contains(&version) && id[8] & 0xc0 == 0x80
}

fn validate_condition_report(
    report_id: &[u8; 16],
    report_hash: &[u8; 32],
    inspector_id: &[u8; 16],
    inspected_at: i64,
    recorded_at: i64,
) -> Result<()> {
    require!(valid_uuid_bytes(report_id), RegistryError::InvalidReportId);
    require!(
        valid_uuid_bytes(inspector_id),
        RegistryError::InvalidInspectorId
    );
    require!(*report_hash != [0; 32], RegistryError::InvalidConditionHash);
    require!(
        inspected_at > 0 && inspected_at <= recorded_at,
        RegistryError::InvalidInspectionTime
    );
    Ok(())
}

fn custody_destination(
    action: CustodyAction,
    from: CustodyState,
    collector: Option<Pubkey>,
    authority: Pubkey,
) -> Result<(CustodyState, Option<Pubkey>)> {
    let destination = match (from, action) {
        (CustodyState::Unknown, CustodyAction::AttestKathaCustody)
        | (CustodyState::InTransit, CustodyAction::ReceiveAtKatha) => {
            require!(collector.is_none(), RegistryError::UnexpectedCustodySubject);
            (CustodyState::KathaHeld, Some(authority))
        }
        (CustodyState::Unknown, CustodyAction::AttestCollectorCustody)
        | (CustodyState::InTransit, CustodyAction::ReceiveByCollector) => {
            let subject = collector.ok_or(RegistryError::MissingCustodySubject)?;
            require_keys_neq!(
                subject,
                Pubkey::default(),
                RegistryError::InvalidCustodySubject
            );
            require_keys_neq!(subject, authority, RegistryError::InvalidCustodySubject);
            (CustodyState::CollectorHeld, Some(subject))
        }
        (CustodyState::KathaHeld, CustodyAction::DispatchFromKatha)
        | (CustodyState::CollectorHeld, CustodyAction::DispatchFromCollector) => {
            require!(collector.is_none(), RegistryError::UnexpectedCustodySubject);
            (CustodyState::InTransit, None)
        }
        _ => return err!(RegistryError::InvalidCustodyTransition),
    };
    Ok(destination)
}

#[account]
pub struct KathaConfig {
    pub authority: Pubkey,
    pub registration_authority: Pubkey,
    pub verifier_authority: Pubkey,
    pub custody_authority: Pubkey,
    pub treasury: Pubkey,
    pub collection: Pubkey,
    pub collection_authority: Pubkey,
    pub bump: u8,
    pub collection_authority_bump: u8,
}

impl KathaConfig {
    pub const SPACE: usize = 8 + 32 * 7 + 2;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ArtworkCategory {
    Mandala,
    Paubha,
    Thangka,
}

impl ArtworkCategory {
    fn id_prefix(self) -> &'static str {
        match self {
            Self::Mandala => "KATHA-MANDALA-",
            Self::Paubha => "KATHA-PAUBHA-",
            Self::Thangka => "KATHA-THANGKA-",
        }
    }
}

#[account]
pub struct ArtworkRecord {
    pub katha_id: String,
    pub artist_id: String,
    pub creator_wallet: Option<Pubkey>,
    pub category: ArtworkCategory,
    pub creation_year: u16,
    pub authorship_evidence_hash: [u8; 32],
    pub collection: Pubkey,
    pub core_asset: Option<Pubkey>,
    pub registered_by: Pubkey,
    pub registered_at: i64,
    pub bump: u8,
}

impl ArtworkRecord {
    // String lengths are bytes; IDs are restricted to ASCII before serialization.
    pub const SPACE: usize =
        8 + (4 + 20) + (4 + 36) + (1 + 32) + 1 + 2 + 32 + 32 + (1 + 32) + 32 + 8 + 1;
}

#[account]
pub struct ArtworkVerification {
    pub artwork: Pubkey,
    pub authorship_evidence_hash: [u8; 32],
    pub verifier: Pubkey,
    pub verified_at: i64,
    pub bump: u8,
}

impl ArtworkVerification {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 8 + 1;
}

#[account]
pub struct MetadataHead {
    pub artwork: Pubkey,
    pub version: u32,
    pub current_revision: Pubkey,
    pub current_hash: [u8; 32],
    pub bump: u8,
}

impl MetadataHead {
    pub const SPACE: usize = 8 + 32 + 4 + 32 + 32 + 1;
}

#[account]
pub struct MetadataRevision {
    pub artwork: Pubkey,
    pub version: u32,
    pub document_hash: [u8; 32],
    pub uri: String,
    pub committed_by: Pubkey,
    pub committed_at: i64,
    pub bump: u8,
}

impl MetadataRevision {
    pub const SPACE: usize = 8 + 32 + 4 + 32 + (4 + 200) + 32 + 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ConditionGrade {
    Excellent,
    Good,
    Fair,
    Poor,
    Damaged,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ConditionReason {
    InitialVerification,
    PreSale,
    PostDelivery,
    PreResale,
    ReturnToCustody,
    Insurance,
}

#[account]
pub struct ConditionHead {
    pub artwork: Pubkey,
    pub version: u32,
    pub current_report: Pubkey,
    pub current_hash: [u8; 32],
    pub bump: u8,
}

impl ConditionHead {
    pub const SPACE: usize = 8 + 32 + 4 + 32 + 32 + 1;
}

#[account]
pub struct ConditionAttestation {
    pub artwork: Pubkey,
    pub version: u32,
    pub report_id: [u8; 16],
    pub report_hash: [u8; 32],
    pub grade: ConditionGrade,
    pub reason: ConditionReason,
    pub inspector_id: [u8; 16],
    pub verifier: Pubkey,
    pub inspected_at: i64,
    pub recorded_at: i64,
    pub owner_scope: Option<Pubkey>,
    pub custody_revision_scope: Option<u64>,
    pub bump: u8,
}

impl ConditionAttestation {
    pub const SPACE: usize =
        8 + 32 + 4 + 16 + 32 + 1 + 1 + 16 + 32 + 8 + 8 + (1 + 32) + (1 + 8) + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum CustodyState {
    Unknown,
    KathaHeld,
    CollectorHeld,
    InTransit,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum CustodyAction {
    AttestKathaCustody,
    AttestCollectorCustody,
    DispatchFromKatha,
    DispatchFromCollector,
    ReceiveAtKatha,
    ReceiveByCollector,
}

#[account]
pub struct CustodyHead {
    pub artwork: Pubkey,
    pub revision: u64,
    pub state: CustodyState,
    pub subject: Option<Pubkey>,
    pub latest_transition: Pubkey,
    pub bump: u8,
}

impl CustodyHead {
    pub const SPACE: usize = 8 + 32 + 8 + 1 + (1 + 32) + 32 + 1;
}

#[account]
pub struct CustodyTransition {
    pub artwork: Pubkey,
    pub revision: u64,
    pub action: CustodyAction,
    pub from_state: CustodyState,
    pub to_state: CustodyState,
    pub from_subject: Option<Pubkey>,
    pub to_subject: Option<Pubkey>,
    pub attested_by: Pubkey,
    pub recorded_at: i64,
    pub bump: u8,
}

impl CustodyTransition {
    pub const SPACE: usize = 8 + 32 + 8 + 1 + 1 + 1 + (1 + 32) + (1 + 32) + 32 + 8 + 1;
}

#[derive(Accounts)]
pub struct InitializePlatform<'info> {
    #[account(init, payer = bootstrap_authority, space = KathaConfig::SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, KathaConfig>,
    #[account(mut)]
    pub bootstrap_authority: Signer<'info>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ RegistryError::InvalidProgramData)]
    pub program: Program<'info, crate::program::KathaRegistry>,
    #[account(constraint = program_data.upgrade_authority_address == Some(bootstrap_authority.key()) @ RegistryError::UnauthorizedBootstrap)]
    pub program_data: Account<'info, ProgramData>,
    /// CHECK: Core owns this account; the handler parses and checks its type and authority.
    #[account(owner = mpl_core::ID @ RegistryError::InvalidCollection)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: The canonical Registry PDA is the Core collection update authority.
    #[account(seeds = [COLLECTION_AUTHORITY_SEED], bump)]
    pub collection_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(katha_id: String)]
pub struct RegisterArtwork<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, KathaConfig>,
    #[account(
        init,
        payer = registration_authority,
        space = ArtworkRecord::SPACE,
        seeds = [ARTWORK_SEED, katha_id.as_bytes()],
        bump
    )]
    pub artwork: Account<'info, ArtworkRecord>,
    #[account(mut, address = config.registration_authority @ RegistryError::UnauthorizedRegistration)]
    pub registration_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VerifyArtwork<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, KathaConfig>,
    #[account(
        seeds = [ARTWORK_SEED, artwork.katha_id.as_bytes()],
        bump = artwork.bump,
        constraint = artwork.collection == config.collection @ RegistryError::InvalidArtworkCollection
    )]
    pub artwork: Account<'info, ArtworkRecord>,
    #[account(
        init,
        payer = verifier_authority,
        space = ArtworkVerification::SPACE,
        seeds = [VERIFICATION_SEED, artwork.key().as_ref()],
        bump
    )]
    pub verification: Account<'info, ArtworkVerification>,
    #[account(mut, address = config.verifier_authority @ RegistryError::UnauthorizedVerifier)]
    pub verifier_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeMetadata<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, KathaConfig>,
    #[account(
        seeds = [ARTWORK_SEED, artwork.katha_id.as_bytes()],
        bump = artwork.bump,
        constraint = artwork.collection == config.collection @ RegistryError::InvalidArtworkCollection,
        constraint = artwork.core_asset.is_none() @ RegistryError::MintedMetadataRequiresCoreSync
    )]
    pub artwork: Account<'info, ArtworkRecord>,
    #[account(
        init,
        payer = registration_authority,
        space = MetadataHead::SPACE,
        seeds = [METADATA_HEAD_SEED, artwork.key().as_ref()],
        bump
    )]
    pub head: Account<'info, MetadataHead>,
    #[account(
        init,
        payer = registration_authority,
        space = MetadataRevision::SPACE,
        seeds = [METADATA_VERSION_SEED, artwork.key().as_ref(), &1u32.to_le_bytes()],
        bump
    )]
    pub revision: Account<'info, MetadataRevision>,
    #[account(mut, address = config.registration_authority @ RegistryError::UnauthorizedRegistration)]
    pub registration_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(expected_version: u32, next_version: u32)]
pub struct ReviseUnmintedMetadata<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, KathaConfig>,
    #[account(
        seeds = [ARTWORK_SEED, artwork.katha_id.as_bytes()],
        bump = artwork.bump,
        constraint = artwork.collection == config.collection @ RegistryError::InvalidArtworkCollection,
        constraint = artwork.core_asset.is_none() @ RegistryError::MintedMetadataRequiresCoreSync
    )]
    pub artwork: Account<'info, ArtworkRecord>,
    #[account(
        mut,
        seeds = [METADATA_HEAD_SEED, artwork.key().as_ref()],
        bump = head.bump,
        constraint = head.artwork == artwork.key() @ RegistryError::InvalidMetadataRelationship
    )]
    pub head: Account<'info, MetadataHead>,
    #[account(
        init,
        payer = registration_authority,
        space = MetadataRevision::SPACE,
        seeds = [METADATA_VERSION_SEED, artwork.key().as_ref(), &next_version.to_le_bytes()],
        bump
    )]
    pub revision: Account<'info, MetadataRevision>,
    #[account(mut, address = config.registration_authority @ RegistryError::UnauthorizedRegistration)]
    pub registration_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(report_id: [u8; 16])]
pub struct InitializeCondition<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, KathaConfig>,
    #[account(
        seeds = [ARTWORK_SEED, artwork.katha_id.as_bytes()],
        bump = artwork.bump,
        constraint = artwork.collection == config.collection @ RegistryError::InvalidArtworkCollection,
        constraint = artwork.core_asset.is_none() @ RegistryError::MintedConditionRequiresOwnerScope
    )]
    pub artwork: Account<'info, ArtworkRecord>,
    #[account(
        seeds = [VERIFICATION_SEED, artwork.key().as_ref()],
        bump = verification.bump,
        constraint = verification.artwork == artwork.key() @ RegistryError::InvalidVerificationRelationship
    )]
    pub verification: Account<'info, ArtworkVerification>,
    #[account(
        init,
        payer = verifier_authority,
        space = ConditionHead::SPACE,
        seeds = [CONDITION_HEAD_SEED, artwork.key().as_ref()],
        bump
    )]
    pub head: Account<'info, ConditionHead>,
    #[account(
        init,
        payer = verifier_authority,
        space = ConditionAttestation::SPACE,
        seeds = [CONDITION_REPORT_SEED, &report_id],
        bump
    )]
    pub report: Account<'info, ConditionAttestation>,
    #[account(mut, address = config.verifier_authority @ RegistryError::UnauthorizedVerifier)]
    pub verifier_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(expected_version: u32, next_version: u32, report_id: [u8; 16])]
pub struct RecordUnmintedCondition<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, KathaConfig>,
    #[account(
        seeds = [ARTWORK_SEED, artwork.katha_id.as_bytes()],
        bump = artwork.bump,
        constraint = artwork.collection == config.collection @ RegistryError::InvalidArtworkCollection,
        constraint = artwork.core_asset.is_none() @ RegistryError::MintedConditionRequiresOwnerScope
    )]
    pub artwork: Account<'info, ArtworkRecord>,
    #[account(
        seeds = [VERIFICATION_SEED, artwork.key().as_ref()],
        bump = verification.bump,
        constraint = verification.artwork == artwork.key() @ RegistryError::InvalidVerificationRelationship
    )]
    pub verification: Account<'info, ArtworkVerification>,
    #[account(
        mut,
        seeds = [CONDITION_HEAD_SEED, artwork.key().as_ref()],
        bump = head.bump,
        constraint = head.artwork == artwork.key() @ RegistryError::InvalidConditionRelationship
    )]
    pub head: Account<'info, ConditionHead>,
    #[account(
        init,
        payer = verifier_authority,
        space = ConditionAttestation::SPACE,
        seeds = [CONDITION_REPORT_SEED, &report_id],
        bump
    )]
    pub report: Account<'info, ConditionAttestation>,
    #[account(mut, address = config.verifier_authority @ RegistryError::UnauthorizedVerifier)]
    pub verifier_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeCustody<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, KathaConfig>,
    #[account(
        seeds = [ARTWORK_SEED, artwork.katha_id.as_bytes()],
        bump = artwork.bump,
        constraint = artwork.collection == config.collection @ RegistryError::InvalidArtworkCollection
    )]
    pub artwork: Account<'info, ArtworkRecord>,
    #[account(
        init,
        payer = custody_authority,
        space = CustodyHead::SPACE,
        seeds = [CUSTODY_HEAD_SEED, artwork.key().as_ref()],
        bump
    )]
    pub head: Account<'info, CustodyHead>,
    #[account(
        init,
        payer = custody_authority,
        space = CustodyTransition::SPACE,
        seeds = [CUSTODY_TRANSITION_SEED, artwork.key().as_ref(), &1_u64.to_le_bytes()],
        bump
    )]
    pub transition: Account<'info, CustodyTransition>,
    #[account(mut, address = config.custody_authority @ RegistryError::UnauthorizedCustody)]
    pub custody_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(expected_revision: u64, next_revision: u64)]
pub struct TransitionCustody<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, KathaConfig>,
    #[account(
        seeds = [ARTWORK_SEED, artwork.katha_id.as_bytes()],
        bump = artwork.bump,
        constraint = artwork.collection == config.collection @ RegistryError::InvalidArtworkCollection
    )]
    pub artwork: Account<'info, ArtworkRecord>,
    #[account(
        mut,
        seeds = [CUSTODY_HEAD_SEED, artwork.key().as_ref()],
        bump = head.bump,
        constraint = head.artwork == artwork.key() @ RegistryError::InvalidCustodyRelationship
    )]
    pub head: Account<'info, CustodyHead>,
    #[account(
        init,
        payer = custody_authority,
        space = CustodyTransition::SPACE,
        seeds = [CUSTODY_TRANSITION_SEED, artwork.key().as_ref(), &next_revision.to_le_bytes()],
        bump
    )]
    pub transition: Account<'info, CustodyTransition>,
    #[account(mut, address = config.custody_authority @ RegistryError::UnauthorizedCustody)]
    pub custody_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct CustodyUpdated {
    pub artwork: Pubkey,
    pub katha_id: String,
    pub transition: Pubkey,
    pub revision: u64,
    pub action: CustodyAction,
    pub from_state: CustodyState,
    pub to_state: CustodyState,
    pub from_subject: Option<Pubkey>,
    pub to_subject: Option<Pubkey>,
    pub attested_by: Pubkey,
    pub recorded_at: i64,
}

#[event]
pub struct PlatformInitialized {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub collection: Pubkey,
    pub registration_authority: Pubkey,
    pub verifier_authority: Pubkey,
    pub custody_authority: Pubkey,
    pub treasury: Pubkey,
}

#[event]
pub struct ArtworkRegistered {
    pub artwork: Pubkey,
    pub katha_id: String,
    pub artist_id: String,
    pub creator_wallet: Option<Pubkey>,
    pub category: ArtworkCategory,
    pub creation_year: u16,
    pub authorship_evidence_hash: [u8; 32],
    pub collection: Pubkey,
    pub registered_by: Pubkey,
    pub registered_at: i64,
}

#[event]
pub struct ArtworkVerified {
    pub artwork: Pubkey,
    pub katha_id: String,
    pub authorship_evidence_hash: [u8; 32],
    pub verifier: Pubkey,
    pub verified_at: i64,
}

#[event]
pub struct MetadataCommitted {
    pub artwork: Pubkey,
    pub katha_id: String,
    pub revision: Pubkey,
    pub version: u32,
    pub document_hash: [u8; 32],
    pub committed_by: Pubkey,
    pub committed_at: i64,
}

#[event]
pub struct ConditionRecorded {
    pub artwork: Pubkey,
    pub katha_id: String,
    pub report: Pubkey,
    pub report_id: [u8; 16],
    pub version: u32,
    pub report_hash: [u8; 32],
    pub grade: ConditionGrade,
    pub reason: ConditionReason,
    pub inspector_id: [u8; 16],
    pub verifier: Pubkey,
    pub inspected_at: i64,
    pub recorded_at: i64,
    pub owner_scope: Option<Pubkey>,
    pub custody_revision_scope: Option<u64>,
}

#[error_code]
pub enum RegistryError {
    #[msg("Bootstrap signer is not the Registry upgrade authority")]
    UnauthorizedBootstrap,
    #[msg("ProgramData does not belong to this Registry program")]
    InvalidProgramData,
    #[msg("Platform role addresses must not be the default address")]
    InvalidRole,
    #[msg("Core collection is invalid or not fresh")]
    InvalidCollection,
    #[msg("Core collection must be controlled by the Registry authority PDA")]
    InvalidCollectionAuthority,
    #[msg("Only the configured registration authority can register artwork")]
    UnauthorizedRegistration,
    #[msg("Katha ID must match its category and have a nonzero six-digit serial")]
    InvalidArtworkId,
    #[msg("Artist ID must be a canonical lowercase UUID")]
    InvalidArtistId,
    #[msg("Creation year must be between 1 and 9999")]
    InvalidCreationYear,
    #[msg("Authorship evidence hash must not be zero")]
    InvalidAuthorshipHash,
    #[msg("Creator wallet must not be the default address")]
    InvalidCreatorWallet,
    #[msg("Only the configured verifier can authenticate artwork")]
    UnauthorizedVerifier,
    #[msg("Artwork belongs to a different Core collection")]
    InvalidArtworkCollection,
    #[msg("The evidence hash does not match the registered artwork")]
    AuthorshipHashMismatch,
    #[msg("Metadata hash must not be zero")]
    InvalidMetadataHash,
    #[msg("Metadata URI must be a bounded public HTTP or HTTPS URI")]
    InvalidMetadataUri,
    #[msg("Metadata version is stale")]
    StaleMetadataVersion,
    #[msg("Metadata versions must advance by exactly one")]
    InvalidMetadataVersion,
    #[msg("Metadata head is unrelated to the artwork")]
    InvalidMetadataRelationship,
    #[msg("Minted metadata changes must synchronize Core URI atomically")]
    MintedMetadataRequiresCoreSync,
    #[msg("Condition report ID must be a valid UUID")]
    InvalidReportId,
    #[msg("Inspector ID must be a valid UUID")]
    InvalidInspectorId,
    #[msg("Condition report hash must not be zero")]
    InvalidConditionHash,
    #[msg("Inspection time must be positive and no later than chain time")]
    InvalidInspectionTime,
    #[msg("Condition version is stale")]
    StaleConditionVersion,
    #[msg("Condition versions must advance by exactly one")]
    InvalidConditionVersion,
    #[msg("Verification does not belong to this artwork")]
    InvalidVerificationRelationship,
    #[msg("Condition head does not belong to this artwork")]
    InvalidConditionRelationship,
    #[msg("Minted inspections require validated ownership and custody scope")]
    MintedConditionRequiresOwnerScope,
    #[msg("The first condition report must be an initial verification inspection")]
    InvalidInitialConditionReason,
    #[msg("Unminted follow-up reports must be pre-sale or insurance inspections")]
    InvalidUnmintedConditionReason,
    #[msg("Signer is not the configured custody authority")]
    UnauthorizedCustody,
    #[msg("Custody revision is stale")]
    StaleCustodyRevision,
    #[msg("Custody revisions must advance by exactly one")]
    InvalidCustodyRevision,
    #[msg("Custody transition is not allowed from the current state")]
    InvalidCustodyTransition,
    #[msg("Collector custody requires an actual custodian address")]
    MissingCustodySubject,
    #[msg("Custodian address must be nonzero and distinct from Katha custody authority")]
    InvalidCustodySubject,
    #[msg("This transition does not accept a collector custodian address")]
    UnexpectedCustodySubject,
    #[msg("Custody head does not belong to this artwork")]
    InvalidCustodyRelationship,
}

#[cfg(feature = "core-cpi-test")]
#[derive(Accounts)]
pub struct CoreCpiProbe<'info> {
    #[account(mut)]
    pub collection: Signer<'info>,
    /// CHECK: This test-only authority is recorded by Core; it cannot authorize the CPI.
    pub update_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: The address constraint fixes the actual Core program ID.
    #[account(address = mpl_core::ID)]
    pub core_program: UncheckedAccount<'info>,
}
