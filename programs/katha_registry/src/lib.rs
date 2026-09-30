use anchor_lang::prelude::*;

declare_id!("5829CUnLsucsi3Tj7573LYV5gNQo35ztGhdY4yhNoAkC");

#[program]
pub mod katha_registry {
    #[cfg(feature = "core-cpi-test")]
    use super::CoreCpiProbe;
    #[cfg(feature = "core-cpi-test")]
    use anchor_lang::prelude::{Context, Result, ToAccountInfo};

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
