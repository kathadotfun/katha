import {
  devnetBootstrapSchema,
  devnetSaleTermsSchema,
  devnetBootstrapSteps,
  type DevnetBootstrapStep,
} from "@katha/shared";
import {
  address,
  createNoopSigner,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
  type MaybeEncodedAccount,
} from "@solana/kit";
import { assertOwnedEncodedAccount } from "./client.js";
import {
  buildCreateCoreCollectionInstruction,
  CORE_PROGRAM_ADDRESS,
  readCoreCollection,
} from "./core.js";
import { nonzeroAddress, readRegistryConfiguration } from "./registration.js";
import * as registry from "./generated/registry/index.js";
import * as market from "./generated/marketplace/index.js";

const LOADER = address("BPFLoaderUpgradeab1e11111111111111111111111");
const TOKEN = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const DEVNET_TEST_SETTINGS = Object.freeze({
  commissionBps: 250,
  secondaryRoyaltyBps: 500,
  inspectionValiditySeconds: 2592000n,
});
export type BootstrapAccountReader = (key: Address) => Promise<MaybeEncodedAccount>;

/** Read loader-v3's public authority header; no deployment key is loaded. */
export async function readBootstrapProgram(
  program: Address,
  read: BootstrapAccountReader,
  operator: Address,
) {
  const [programData] = await getProgramDerivedAddress({
    programAddress: LOADER,
    seeds: [getAddressEncoder().encode(program)],
  });
  const account = await read(program),
    data = await read(programData);
  assertOwnedEncodedAccount(account, program, LOADER, 36);
  assertOwnedEncodedAccount(data, programData, LOADER, 45);
  if (
    !account.executable ||
    account.data.length !== 36 ||
    data.executable ||
    new DataView(account.data.buffer, account.data.byteOffset).getUint32(0, true) !==
      2 ||
    getAddressDecoder().decode(account.data.subarray(4)) !== programData ||
    new DataView(data.data.buffer, data.data.byteOffset).getUint32(0, true) !== 3 ||
    data.data[12] !== 1 ||
    getAddressDecoder().decode(data.data.subarray(13, 45)) !== operator
  ) {
    throw new TypeError(
      "Deployed upgrade authority must match the connected bootstrap operator",
    );
  }
  return programData;
}
export async function assertEmptyBootstrapAccount(
  key: Address,
  read: BootstrapAccountReader,
) {
  if ((await read(key)).exists)
    throw new TypeError(
      "Bootstrap account already exists; inspect it instead of initializing again",
    );
}

/** Only pinned, generated bootstrap instructions are constructed from public inputs. */
export async function prepareDevnetBootstrapInstruction(
  step: DevnetBootstrapStep,
  input: unknown,
  read: BootstrapAccountReader,
  saleInput?: unknown,
): Promise<Instruction> {
  if (!devnetBootstrapSteps.includes(step))
    throw new TypeError("Unsupported bootstrap operation");
  const config = devnetBootstrapSchema.parse(input);
  const operator = nonzeroAddress(address(config.operator));
  const collection = address(config.collection);
  const [registryConfig] = await registry.findConfigPda();
  const [collectionAuthority] = await registry.findCollectionAuthorityPda();
  const [marketConfig] = await market.findConfigPda();
  const signer = createNoopSigner(operator);
  if (step === "collection") {
    await assertEmptyBootstrapAccount(collection, read);
    const core = await read(CORE_PROGRAM_ADDRESS);
    if (!core.exists || !core.executable)
      throw new TypeError("Core program is unavailable");
    await readBootstrapProgram(registry.KATHA_REGISTRY_PROGRAM_ADDRESS, read, operator);
    return buildCreateCoreCollectionInstruction({
      collectionAddress: collection,
      payerAddress: operator,
      updateAuthorityAddress: collectionAuthority,
      name: "Katha Devnet Test Collection",
      uri: config.collectionUri,
    });
  }
  if (step === "registry") {
    await assertEmptyBootstrapAccount(registryConfig, read);
    const programData = await readBootstrapProgram(
      registry.KATHA_REGISTRY_PROGRAM_ADDRESS,
      read,
      operator,
    );
    readCoreCollection(await read(collection), collection, collectionAuthority);
    return registry.getInitializePlatformInstruction({
      config: registryConfig,
      bootstrapAuthority: signer,
      program: registry.KATHA_REGISTRY_PROGRAM_ADDRESS,
      programData,
      collection,
      collectionAuthority,
      registrationAuthority: address(config.registrationAuthority),
      verifierAuthority: address(config.verifierAuthority),
      custodyAuthority: address(config.custodyAuthority),
      treasury: address(config.treasury),
    });
  }
  const registryAccount = await read(registryConfig);
  assertOwnedEncodedAccount(
    registryAccount,
    registryConfig,
    registry.KATHA_REGISTRY_PROGRAM_ADDRESS,
    registry.getKathaConfigSize(),
  );
  const { state: platform } = await readRegistryConfiguration(registryAccount);
  if (
    platform.authority !== operator ||
    platform.collection !== collection ||
    platform.registrationAuthority !== config.registrationAuthority ||
    platform.verifierAuthority !== config.verifierAuthority ||
    platform.custodyAuthority !== config.custodyAuthority ||
    platform.treasury !== config.treasury
  ) {
    throw new TypeError(
      "Public inputs do not match initialized Registry authorities/collection",
    );
  }
  if (step === "marketplace") {
    await assertEmptyBootstrapAccount(marketConfig, read);
    const programData = await readBootstrapProgram(
      market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
      read,
      operator,
    );
    const mint = address(config.paymentMint),
      mintAccount = await read(mint);
    assertOwnedEncodedAccount(mintAccount, mint, TOKEN, 82);
    if (
      mintAccount.executable ||
      mintAccount.data.length !== 82 ||
      mintAccount.data[44] !== 6 ||
      mintAccount.data[45] !== 1 ||
      new DataView(mintAccount.data.buffer, mintAccount.data.byteOffset).getUint32(
        46,
        true,
      ) !== 0
    ) {
      throw new TypeError(
        "Payment mint must be initialized classic SPL, six decimals, without freeze authority",
      );
    }
    return market.getInitializeMarketplaceInstruction({
      config: marketConfig,
      bootstrapAuthority: signer,
      authority: signer,
      program: market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
      programData,
      registryProgram: registry.KATHA_REGISTRY_PROGRAM_ADDRESS,
      registryConfig,
      paymentMint: mint,
      ...DEVNET_TEST_SETTINGS,
    });
  }
  if (step !== "sale-terms") throw new TypeError("Unsupported bootstrap operation");
  const sale = devnetSaleTermsSchema.parse(saleInput);
  const account = await read(marketConfig);
  assertOwnedEncodedAccount(
    account,
    marketConfig,
    market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
    market.getMarketplaceConfigSize(),
  );
  if (
    account.executable ||
    account.data.length !== market.getMarketplaceConfigSize() ||
    market.identifyKathaMarketplaceAccount(account.data) !==
      market.KathaMarketplaceAccount.MarketplaceConfig
  )
    throw new TypeError("Invalid Marketplace configuration");
  const settings = market.getMarketplaceConfigDecoder().decode(account.data);
  const [, bump] = await market.findConfigPda();
  if (
    settings.version !== 1 ||
    settings.bump !== bump ||
    settings.authority !== operator ||
    settings.registryProgram !== registry.KATHA_REGISTRY_PROGRAM_ADDRESS ||
    settings.registryConfig !== registryConfig ||
    settings.collection !== collection ||
    settings.treasury !== platform.treasury ||
    settings.paymentMint !== config.paymentMint ||
    settings.tokenProgram !== TOKEN ||
    settings.paymentDecimals !== 6 ||
    settings.commissionBps !== DEVNET_TEST_SETTINGS.commissionBps ||
    settings.secondaryRoyaltyBps !== DEVNET_TEST_SETTINGS.secondaryRoyaltyBps ||
    settings.inspectionValiditySeconds !==
      DEVNET_TEST_SETTINGS.inspectionValiditySeconds
  )
    throw new TypeError(
      "Marketplace configuration does not match the reviewed Devnet defaults",
    );
  const [artwork] = await registry.findArtworkPda({ kathaId: sale.kathaId });
  const record = await read(artwork);
  assertOwnedEncodedAccount(
    record,
    artwork,
    registry.KATHA_REGISTRY_PROGRAM_ADDRESS,
    8,
  );
  if (
    record.executable ||
    registry.identifyKathaRegistryAccount(record.data) !==
      registry.KathaRegistryAccount.ArtworkRecord
  )
    throw new TypeError("Invalid registered artwork");
  const art = registry.getArtworkRecordDecoder().decode(record.data);
  const [, artworkBump] = await registry.findArtworkPda({ kathaId: sale.kathaId });
  if (
    art.kathaId !== sale.kathaId ||
    art.collection !== collection ||
    art.bump !== artworkBump
  )
    throw new TypeError("Artwork identity/collection mismatch");
  const [saleTerms] = await market.findSaleTermsPda({ artwork });
  await assertEmptyBootstrapAccount(saleTerms, read);
  return market.getInitializeSaleTermsInstruction({
    config: marketConfig,
    registryProgram: registry.KATHA_REGISTRY_PROGRAM_ADDRESS,
    artwork,
    saleTerms,
    authority: signer,
    artistPayout: address(sale.artistPayout),
  });
}
