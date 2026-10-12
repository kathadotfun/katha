import {
  artistAttributionSchema,
  artworkSchema,
  type ArtistAttribution,
  type Artwork,
} from "@katha/shared";
import {
  address,
  appendTransactionMessageInstruction,
  blockhash,
  createNoopSigner,
  createTransactionMessage,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  getTransactionMessageComputeUnitLimit,
  getTransactionMessageHeapSize,
  getTransactionMessageLoadedAccountsDataSizeLimit,
  getTransactionMessagePriorityFeeLamports,
  isSignerRole,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  setTransactionMessagePriorityFeeLamports,
  type Address,
  type BlockhashLifetimeConstraint,
  type EncodedAccount,
  type Instruction,
  type TransactionMessage,
} from "@solana/kit";
import {
  assertOwnedEncodedAccount,
  selectKathaTransactionVersion,
  type KathaCluster,
  type WalletTransactionVersion,
} from "./client.js";
import { readCoreCollection } from "./core.js";
import {
  ArtworkCategory,
  findArtworkPda,
  findCollectionAuthorityPda,
  findConfigPda,
  getInitializePlatformInstruction,
  getKathaConfigDecoder,
  getKathaConfigSize,
  getRegisterArtworkInstruction,
  identifyKathaRegistryAccount,
  KATHA_REGISTRY_PROGRAM_ADDRESS,
  KathaRegistryAccount,
} from "./generated/registry/index.js";

const LOADER = address("BPFLoaderUpgradeab1e11111111111111111111111");
const SYSTEM = address("11111111111111111111111111111111");
const CATEGORY = {
  MANDALA: ArtworkCategory.Mandala,
  PAUBHA: ArtworkCategory.Paubha,
  THANGKA: ArtworkCategory.Thangka,
} as const;

export interface RegistryTransactionContext {
  cluster: KathaCluster;
  feePayerAddress: Address;
  authorityAddress: Address;
  supportedTransactionVersions: ReadonlySet<WalletTransactionVersion>;
  lifetime: BlockhashLifetimeConstraint;
  currentBlockHeight: bigint;
}

export interface PlatformInitializationInput {
  programAccount: EncodedAccount;
  programDataAccount: EncodedAccount;
  collectionAccount: EncodedAccount;
  registrationAuthority: Address;
  verifierAuthority: Address;
  custodyAuthority: Address;
  treasury: Address;
}

export type ArtworkRegistrationInput = Pick<
  Artwork,
  "kathaId" | "category" | "creationYear" | "authorshipEvidenceHash"
> &
  Pick<ArtistAttribution, "artistId" | "creatorWallet">;

// v1 messages carry resource limits in the header, and an omitted limit is zero rather
// than the v0 default. Fix them at the v0 single-instruction defaults so every reviewed
// operation runs identically on both versions, and set a zero priority fee so wallets
// need not insert their own fee fields after preparation.
export const KATHA_V1_COMPUTE_UNIT_LIMIT = 200_000;
export const KATHA_V1_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;

export function hasKathaTransactionConfig(message: TransactionMessage) {
  if (message.version !== 1) return true;
  return (
    getTransactionMessageComputeUnitLimit(message) === KATHA_V1_COMPUTE_UNIT_LIMIT &&
    getTransactionMessageLoadedAccountsDataSizeLimit(message) ===
      KATHA_V1_LOADED_ACCOUNTS_DATA_SIZE_LIMIT &&
    getTransactionMessagePriorityFeeLamports(message) === 0n &&
    getTransactionMessageHeapSize(message) === undefined
  );
}

export function nonzeroAddress(value: Address): Address {
  const result = address(value);
  if (result === SYSTEM) throw new TypeError("Wallet or role address must not be zero");
  return result;
}

export function unsignedMessage(
  context: RegistryTransactionContext,
  generated: Instruction,
) {
  const version = selectKathaTransactionVersion(
    context.cluster,
    context.supportedTransactionVersions,
  );
  const feePayer = nonzeroAddress(context.feePayerAddress);
  nonzeroAddress(context.authorityAddress);
  const height = context.currentBlockHeight;
  const expiry = context.lifetime.lastValidBlockHeight;
  if (
    typeof height !== "bigint" ||
    typeof expiry !== "bigint" ||
    height < 0n ||
    expiry < height ||
    expiry > 0xffff_ffff_ffff_ffffn
  ) {
    throw new TypeError("Blockhash lifetime is invalid or already expired");
  }
  const lifetime = {
    blockhash: blockhash(context.lifetime.blockhash),
    lastValidBlockHeight: expiry,
  };
  // Generated builders need a signer input. Keep only address/role metadata;
  // the no-op signer carries no key, and no signer implementation leaves this boundary.
  const instruction = Object.freeze({
    programAddress: generated.programAddress,
    accounts: Object.freeze(
      (generated.accounts ?? []).map(({ address, role }) =>
        Object.freeze({ address, role }),
      ),
    ),
    data: Uint8Array.from(generated.data ?? []),
  });
  const transactionMessage = appendTransactionMessageInstruction(
    instruction,
    setTransactionMessageLifetimeUsingBlockhash(
      lifetime,
      setTransactionMessageFeePayer(
        feePayer,
        version === 1
          ? setTransactionMessageLoadedAccountsDataSizeLimit(
              KATHA_V1_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
              setTransactionMessageComputeUnitLimit(
                KATHA_V1_COMPUTE_UNIT_LIMIT,
                setTransactionMessagePriorityFeeLamports(
                  0n,
                  createTransactionMessage({ version: 1 }),
                ),
              ),
            )
          : createTransactionMessage({ version: 0 }),
      ),
    ),
  );
  const requiredSignerAddresses = [
    ...new Set([
      feePayer,
      ...instruction.accounts
        .filter(({ role }) => isSignerRole(role))
        .map(({ address }) => address),
    ]),
  ];
  return Object.freeze({
    cluster: context.cluster,
    instruction,
    transactionMessage,
    requiredSignerAddresses: Object.freeze(requiredSignerAddresses),
  });
}

/** Builds a bootstrap message from caller-fetched upgradeable-loader and Core snapshots. */
export async function buildInitializePlatformTransaction(
  context: RegistryTransactionContext,
  input: PlatformInitializationInput,
) {
  const authority = nonzeroAddress(context.authorityAddress);
  const [config] = await findConfigPda();
  const [collectionAuthority] = await findCollectionAuthorityPda();
  const [programData] = await getProgramDerivedAddress({
    programAddress: LOADER,
    seeds: [getAddressEncoder().encode(KATHA_REGISTRY_PROGRAM_ADDRESS)],
  });
  assertOwnedEncodedAccount(
    input.programAccount,
    KATHA_REGISTRY_PROGRAM_ADDRESS,
    LOADER,
    36,
  );
  assertOwnedEncodedAccount(input.programDataAccount, programData, LOADER, 45);
  const program = input.programAccount;
  const data = input.programDataAccount;
  const programTag = new DataView(
    program.data.buffer,
    program.data.byteOffset,
  ).getUint32(0, true);
  const dataTag = new DataView(data.data.buffer, data.data.byteOffset).getUint32(
    0,
    true,
  );
  // Loader-v3's Program stores its ProgramData pointer; ProgramData's header
  // contains an eight-byte slot and a one-byte optional upgrade-authority tag.
  if (
    !program.executable ||
    program.data.length !== 36 ||
    programTag !== 2 ||
    getAddressDecoder().decode(program.data.subarray(4, 36)) !== programData ||
    data.executable ||
    dataTag !== 3 ||
    data.data[12] !== 1 ||
    getAddressDecoder().decode(data.data.subarray(13, 45)) !== authority
  ) {
    throw new TypeError(
      "Registry bootstrap signer or ProgramData relationship is invalid",
    );
  }
  const collection = address(input.collectionAccount.address);
  readCoreCollection(input.collectionAccount, collection, collectionAuthority);
  const instruction = getInitializePlatformInstruction({
    config,
    bootstrapAuthority: createNoopSigner(authority),
    program: KATHA_REGISTRY_PROGRAM_ADDRESS,
    programData,
    collection,
    collectionAuthority,
    registrationAuthority: nonzeroAddress(input.registrationAuthority),
    verifierAuthority: nonzeroAddress(input.verifierAuthority),
    custodyAuthority: nonzeroAddress(input.custodyAuthority),
    treasury: nonzeroAddress(input.treasury),
  });
  return Object.freeze({
    ...unsignedMessage(context, instruction),
    addresses: Object.freeze({ config, programData, collection, collectionAuthority }),
  });
}

// Internal account validation shared by Registry operation builders.
export async function readRegistryConfiguration(configAccount: EncodedAccount) {
  const [config, configBump] = await findConfigPda();
  const [collectionAuthority, collectionAuthorityBump] =
    await findCollectionAuthorityPda();
  assertOwnedEncodedAccount(
    configAccount,
    config,
    KATHA_REGISTRY_PROGRAM_ADDRESS,
    getKathaConfigSize(),
  );
  if (
    configAccount.executable ||
    configAccount.data.length !== getKathaConfigSize() ||
    identifyKathaRegistryAccount(configAccount.data) !==
      KathaRegistryAccount.KathaConfig
  )
    throw new TypeError("Registry configuration account is invalid");
  const state = getKathaConfigDecoder().decode(configAccount.data);
  if (
    state.bump !== configBump ||
    state.collectionAuthority !== collectionAuthority ||
    state.collectionAuthorityBump !== collectionAuthorityBump
  )
    throw new TypeError("Configuration PDA relationship is invalid");
  return { config, state };
}

/** Registers an immutable identity; it neither mints Core nor changes custody. */
export async function buildRegisterArtworkTransaction(
  context: RegistryTransactionContext,
  configAccount: EncodedAccount,
  input: ArtworkRegistrationInput,
) {
  const { config, state } = await readRegistryConfiguration(configAccount);
  if (state.registrationAuthority !== nonzeroAddress(context.authorityAddress))
    throw new TypeError("Registration authority is invalid");

  const kathaId = artworkSchema.shape.kathaId.parse(input.kathaId);
  const category = artworkSchema.shape.category.parse(input.category);
  const creationYear = artworkSchema.shape.creationYear.parse(input.creationYear);
  const artistId = artistAttributionSchema.shape.artistId.parse(input.artistId);
  if (
    !kathaId.startsWith(`KATHA-${category}-`) ||
    artistId !== artistId.toLowerCase()
  ) {
    throw new TypeError("Artwork category or canonical artist identity is invalid");
  }
  const hex = artworkSchema.shape.authorshipEvidenceHash.parse(
    input.authorshipEvidenceHash,
  );
  if (/^0{64}$/.test(hex))
    throw new TypeError("Authorship evidence hash must not be zero");
  const hash = new Uint8Array(32);
  for (let index = 0; index < hash.length; index++) {
    hash[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  const creatorWallet =
    input.creatorWallet == null ? null : nonzeroAddress(address(input.creatorWallet));
  const [artwork] = await findArtworkPda({ kathaId });
  const instruction = getRegisterArtworkInstruction({
    config,
    artwork,
    registrationAuthority: createNoopSigner(state.registrationAuthority),
    kathaId,
    artistId,
    creatorWallet,
    category: CATEGORY[category],
    creationYear,
    authorshipEvidenceHash: hash,
  });
  return Object.freeze({
    ...unsignedMessage(context, instruction),
    addresses: Object.freeze({ config, artwork, collection: state.collection }),
  });
}
