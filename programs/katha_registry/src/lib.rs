use anchor_lang::prelude::*;

declare_id!("5829CUnLsucsi3Tj7573LYV5gNQo35ztGhdY4yhNoAkC");

pub const CONFIG_SEED: &[u8] = b"katha-config";
pub const COLLECTION_AUTHORITY_SEED: &[u8] = b"collection-authority";
pub const ARTWORK_SEED: &[u8] = b"artwork";
pub const VERIFICATION_SEED: &[u8] = b"verification";

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
