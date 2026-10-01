use anchor_lang::prelude::*;

declare_id!("5829CUnLsucsi3Tj7573LYV5gNQo35ztGhdY4yhNoAkC");

pub const CONFIG_SEED: &[u8] = b"katha-config";
pub const COLLECTION_AUTHORITY_SEED: &[u8] = b"collection-authority";

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
