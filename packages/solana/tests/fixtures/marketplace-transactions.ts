// Synthetic encoded snapshots; Metaplex serialization stays in this test adapter.
import { Key } from "@metaplex-foundation/mpl-core";
import { getAssetV1AccountDataSerializer } from "@metaplex-foundation/mpl-core/dist/src/generated/types/assetV1AccountData.js";
import { getCollectionV1AccountDataSerializer } from "@metaplex-foundation/mpl-core/dist/src/generated/types/collectionV1AccountData.js";
import { publicKey } from "@metaplex-foundation/umi";
import {
  address,
  blockhash,
  generateKeyPairSigner,
  lamports,
  type Address,
  type EncodedAccount,
} from "@solana/kit";
import { CORE_PROGRAM_ADDRESS } from "../../src/core.js";
import type {
  MarketplacePurchaseAccounts,
  MarketplaceTransactionContext,
} from "../../src/marketplace.js";
import * as market from "../../src/generated/marketplace/index.js";
import * as registry from "../../src/generated/registry/index.js";

export function snapshot(
  accountAddress: Address,
  owner: Address,
  bytes: Uint8Array,
): EncodedAccount & { exists: true; data: Uint8Array } {
  return {
    exists: true,
    address: accountAddress,
    programAddress: owner,
    executable: false,
    lamports: lamports(1_000_000_000n),
    space: BigInt(bytes.length),
    data: bytes,
  };
}
export async function marketplaceTransactionFixture() {
  const wallet = async () => (await generateKeyPairSigner()).address;
  const seller = await wallet(),
    buyer = await wallet(),
    artist = await wallet(),
    treasury = await wallet(),
    feePayer = await wallet(),
    mint = await wallet(),
    collection = await wallet(),
    report = await wallet();
  const kathaId = "KATHA-PAUBHA-000001" as const;
  const [config, bump] = await market.findConfigPda();
  const [registryConfig, registryBump] = await registry.findConfigPda();
  const [collectionAuthority, collectionAuthorityBump] =
    await registry.findCollectionAuthorityPda();
  const [artwork, artworkBump] = await registry.findArtworkPda({ kathaId });
  const [asset] = await registry.findAssetPda({ artwork });
  const [listing, listingBump] = await market.findListingPda({ asset });
  const [head, headBump] = await registry.findHeadPda({ artwork });
  const [saleTerms, termsBump] = await market.findSaleTermsPda({ artwork });
  const configuration: market.MarketplaceConfigArgs = {
    version: 1,
    authority: seller,
    registryProgram: registry.KATHA_REGISTRY_PROGRAM_ADDRESS,
    registryConfig,
    collection,
    treasury,
    paymentMint: mint,
    tokenProgram: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    paymentDecimals: 6,
    commissionBps: 250,
    secondaryRoyaltyBps: 500,
    inspectionValiditySeconds: 2_592_000n,
    bump,
  };
  const ledger: market.ListingRecordArgs = {
    version: 1,
    config,
    artwork,
    asset,
    seller,
    artistPayout: artist,
    paymentMint: mint,
    conditionReport: report,
    conditionHash: new Uint8Array(32).fill(7),
    conditionVersion: 1,
    custodyRevision: 1n,
    price: 100_000_000n,
    createdAt: 1_800_000_000n,
    expiresAt: 1_800_003_600n,
    revision: 1n,
    completedSales: 0n,
    saleKind: market.SaleKind.Primary,
    status: market.ListingStatus.Active,
    bump: listingBump,
  };
  const record: registry.ArtworkRecordArgs = {
    kathaId,
    artistId: "123e4567-e89b-42d3-a456-426614174000",
    creatorWallet: null,
    category: registry.ArtworkCategory.Paubha,
    creationYear: 2026,
    authorshipEvidenceHash: new Uint8Array(32).fill(3),
    collection,
    coreAsset: asset,
    registeredBy: seller,
    registeredAt: 1_800_000_000n,
    bump: artworkBump,
  };
  const artworkBytes = new Uint8Array(246);
  artworkBytes.set(registry.getArtworkRecordEncoder().encode(record));
  const accounts: MarketplacePurchaseAccounts = {
    marketplaceConfigAccount: snapshot(
      config,
      market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
      Uint8Array.from(market.getMarketplaceConfigEncoder().encode(configuration)),
    ),
    registryConfigAccount: snapshot(
      registryConfig,
      registry.KATHA_REGISTRY_PROGRAM_ADDRESS,
      Uint8Array.from(
        registry.getKathaConfigEncoder().encode({
          authority: seller,
          registrationAuthority: seller,
          verifierAuthority: artist,
          custodyAuthority: treasury,
          treasury,
          collection,
          collectionAuthority,
          bump: registryBump,
          collectionAuthorityBump,
        }),
      ),
    ),
    artworkAccount: snapshot(
      artwork,
      registry.KATHA_REGISTRY_PROGRAM_ADDRESS,
      artworkBytes,
    ),
    assetAccount: snapshot(
      asset,
      CORE_PROGRAM_ADDRESS,
      getAssetV1AccountDataSerializer().serialize({
        key: Key.AssetV1,
        owner: publicKey(seller),
        updateAuthority: { __kind: "Collection", fields: [publicKey(collection)] },
        name: kathaId,
        uri: "https://example.com/art.json",
        seq: null,
      }),
    ),
    collectionAccount: snapshot(
      collection,
      CORE_PROGRAM_ADDRESS,
      getCollectionV1AccountDataSerializer().serialize({
        key: Key.CollectionV1,
        updateAuthority: publicKey(collectionAuthority),
        name: "Synthetic collection",
        uri: "https://example.com/collection.json",
        numMinted: 1,
        currentSize: 1,
      }),
    ),
    listingAccount: snapshot(
      listing,
      market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
      Uint8Array.from(market.getListingRecordEncoder().encode(ledger)),
    ),
    conditionHeadAccount: snapshot(
      head,
      registry.KATHA_REGISTRY_PROGRAM_ADDRESS,
      Uint8Array.from(
        registry.getConditionHeadEncoder().encode({
          artwork,
          version: 1,
          currentReport: report,
          currentHash: ledger.conditionHash,
          bump: headBump,
        }),
      ),
    ),
    saleTermsAccount: snapshot(
      saleTerms,
      market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
      Uint8Array.from(
        market.getArtworkSaleTermsEncoder().encode({
          version: 1,
          artwork,
          artistPayout: artist,
          bump: termsBump,
        }),
      ),
    ),
  };
  const context: MarketplaceTransactionContext = {
    cluster: "localnet",
    feePayerAddress: feePayer,
    authorityAddress: buyer,
    supportedTransactionVersions: new Set([0, 1]),
    lifetime: {
      blockhash: blockhash("11111111111111111111111111111111"),
      lastValidBlockHeight: 100n,
    },
    currentBlockHeight: 1n,
    chainTime: 1_800_000_000n,
  };
  return {
    accounts,
    context,
    kathaId,
    seller,
    buyer,
    artist,
    treasury,
    mint,
    config,
    registryConfig,
    artwork,
    asset,
    listing,
    report,
    saleTerms,
    ledger,
    configuration,
  };
}
