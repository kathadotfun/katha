import {
  kathaIdSchema,
  listingPriceSchema,
  marketplaceFeeRatesSchema,
  type KathaId,
} from "@katha/shared";
import {
  address,
  createNoopSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type EncodedAccount,
  type MaybeEncodedAccount,
} from "@solana/kit";
import { assertOwnedEncodedAccount } from "./client.js";
import { checkAccount, equalBytes } from "./attestation.js";
import { readCoreAsset, readCoreCollection } from "./core.js";
import {
  nonzeroAddress,
  readRegistryConfiguration,
  unsignedMessage,
  type RegistryTransactionContext,
} from "./registration.js";
import * as market from "./generated/marketplace/index.js";
import * as registry from "./generated/registry/index.js";

const TOKEN = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const U64_MAX = (1n << 64n) - 1n;
const I64_MAX = (1n << 63n) - 1n;

export interface MarketplaceTransactionContext extends RegistryTransactionContext {
  /** Caller-fetched chain timestamp; not the browser clock. */
  chainTime: bigint;
}
export interface MarketplaceArtworkAccounts {
  marketplaceConfigAccount: EncodedAccount;
  registryConfigAccount: EncodedAccount;
  artworkAccount: EncodedAccount;
  assetAccount: EncodedAccount;
  collectionAccount: EncodedAccount;
  listingAccount: MaybeEncodedAccount;
}
export interface MarketplaceListingAccounts extends MarketplaceArtworkAccounts {
  conditionHeadAccount: EncodedAccount;
}
export interface MarketplacePurchaseAccounts extends MarketplaceListingAccounts {
  saleTermsAccount: EncodedAccount;
}
export interface MarketplaceRevisionInput {
  kathaId: KathaId;
  expectedRevision: bigint;
}
export interface MarketplaceListingInput extends MarketplaceRevisionInput {
  price: string;
  expiresAt: bigint;
}
export interface MarketplacePurchaseInput extends MarketplaceRevisionInput {
  buyerAddress: Address;
  paymentMintAddress: Address;
  expectedPrice: string;
}

export type MarketplaceAddresses = Record<
  "config" | "registryConfig" | "artwork" | "asset" | "listing" | "collection",
  Address
>;
export type MarketplacePurchaseAddresses = MarketplaceAddresses &
  Record<
    | "saleTerms"
    | "conditionReport"
    | "buyer"
    | "seller"
    | "artistPayout"
    | "treasury"
    | "paymentMint"
    | "buyerTokens"
    | "sellerTokens"
    | "artistTokens"
    | "treasuryTokens",
    Address
  >;
export type PreparedMarketplaceTransaction<
  TAddresses extends MarketplaceAddresses = MarketplaceAddresses,
> = ReturnType<typeof unsignedMessage> & {
  readonly addresses: Readonly<TAddresses>;
  readonly nextRevision: bigint;
};

function bounded(value: bigint, maximum: bigint, label: string) {
  if (typeof value !== "bigint" || value < 0n || value > maximum)
    throw new TypeError(`${label} is outside its integer range`);
  return value;
}
function marketAccount(
  account: EncodedAccount,
  expected: Address,
  kind: market.KathaMarketplaceAccount,
  size: number,
) {
  assertOwnedEncodedAccount(
    account,
    expected,
    market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
    size,
  );
  if (
    account.executable ||
    account.data.length !== size ||
    market.identifyKathaMarketplaceAccount(account.data) !== kind
  )
    throw new TypeError("Marketplace account type or allocated size is invalid");
}

async function artworkState(
  context: MarketplaceTransactionContext,
  accounts: MarketplaceArtworkAccounts,
  input: MarketplaceRevisionInput,
) {
  const now = bounded(context.chainTime, I64_MAX, "Chain timestamp");
  if (now === 0n) throw new TypeError("Chain timestamp must be positive");
  const revision = bounded(input.expectedRevision, U64_MAX - 1n, "Listing revision");
  const actor = nonzeroAddress(context.authorityAddress);
  const kathaId = kathaIdSchema.parse(input.kathaId);
  const { config: registryConfig, state: platform } = await readRegistryConfiguration(
    accounts.registryConfigAccount,
  );
  const [config, configBump] = await market.findConfigPda();
  marketAccount(
    accounts.marketplaceConfigAccount,
    config,
    market.KathaMarketplaceAccount.MarketplaceConfig,
    market.getMarketplaceConfigSize(),
  );
  const configuration = market
    .getMarketplaceConfigDecoder()
    .decode(accounts.marketplaceConfigAccount.data);
  if (
    configuration.version !== 1 ||
    configuration.bump !== configBump ||
    configuration.registryProgram !== registry.KATHA_REGISTRY_PROGRAM_ADDRESS ||
    configuration.registryConfig !== registryConfig ||
    configuration.collection !== platform.collection ||
    configuration.treasury !== platform.treasury ||
    configuration.tokenProgram !== TOKEN ||
    configuration.paymentDecimals !== 6 ||
    configuration.inspectionValiditySeconds === 0n
  )
    throw new TypeError("Marketplace configuration binding is invalid");
  nonzeroAddress(configuration.paymentMint);
  nonzeroAddress(configuration.treasury);
  marketplaceFeeRatesSchema.parse({
    platformCommissionBps: configuration.commissionBps,
    secondaryRoyaltyBps: configuration.secondaryRoyaltyBps,
  });
  const [artwork, artworkBump] = await registry.findArtworkPda({ kathaId });
  checkAccount(
    accounts.artworkAccount,
    artwork,
    registry.KathaRegistryAccount.ArtworkRecord,
    246,
  );
  const record = registry
    .getArtworkRecordDecoder()
    .decode(accounts.artworkAccount.data);
  const [asset] = await registry.findAssetPda({ artwork });
  const categories = ["MANDALA", "PAUBHA", "THANGKA"] as const;
  if (
    record.kathaId !== kathaId ||
    record.bump !== artworkBump ||
    record.collection !== platform.collection ||
    !categories[record.category] ||
    !kathaId.startsWith(`KATHA-${categories[record.category]}-`) ||
    record.coreAsset.__option !== "Some" ||
    record.coreAsset.value !== asset
  )
    throw new TypeError("Artwork identity or Core binding is invalid");
  const core = readCoreAsset(accounts.assetAccount, asset, platform.collection);
  if (core.name !== kathaId) throw new TypeError("Core artwork name is invalid");
  readCoreCollection(
    accounts.collectionAccount,
    platform.collection,
    platform.collectionAuthority,
  );
  const [listing, listingBump] = await market.findListingPda({ asset });
  let ledger: market.ListingRecord | null = null;
  if (accounts.listingAccount.address !== listing)
    throw new TypeError("Listing PDA is invalid");
  if (accounts.listingAccount.exists) {
    // CreateListing accepts a prefunded but otherwise empty system-owned PDA.
    const empty =
      accounts.listingAccount.programAddress ===
        address("11111111111111111111111111111111") &&
      accounts.listingAccount.data.length === 0 &&
      !accounts.listingAccount.executable;
    if (!empty) {
      marketAccount(
        accounts.listingAccount,
        listing,
        market.KathaMarketplaceAccount.ListingRecord,
        market.getListingRecordSize(),
      );
      ledger = market.getListingRecordDecoder().decode(accounts.listingAccount.data);
      if (
        ledger.version !== 1 ||
        ledger.bump !== listingBump ||
        ledger.config !== config ||
        ledger.artwork !== artwork ||
        ledger.asset !== asset ||
        ledger.paymentMint !== configuration.paymentMint ||
        ledger.revision !== revision ||
        ledger.saleKind !==
          (ledger.completedSales === 0n
            ? market.SaleKind.Primary
            : market.SaleKind.Secondary)
      )
        throw new TypeError("Listing binding or reviewed revision is stale");
      nonzeroAddress(ledger.seller);
      nonzeroAddress(ledger.artistPayout);
    }
  }
  if (!ledger && revision !== 0n)
    throw new TypeError("New listing requires revision zero");
  return {
    now,
    revision,
    actor,
    kathaId,
    configuration,
    record,
    core,
    ledger,
    addresses: {
      config,
      registryConfig,
      artwork,
      asset,
      listing,
      collection: platform.collection,
    },
  };
}

async function conditionHead(accounts: MarketplaceListingAccounts, artwork: Address) {
  const [head, bump] = await registry.findHeadPda({ artwork });
  checkAccount(
    accounts.conditionHeadAccount,
    head,
    registry.KathaRegistryAccount.ConditionHead,
    registry.getConditionHeadSize(),
  );
  const state = registry
    .getConditionHeadDecoder()
    .decode(accounts.conditionHeadAccount.data);
  if (
    state.artwork !== artwork ||
    state.bump !== bump ||
    state.version === 0 ||
    state.currentHash.every((byte) => byte === 0)
  )
    throw new TypeError("Condition head binding is invalid");
  nonzeroAddress(state.currentReport);
  return state;
}
function active(state: Awaited<ReturnType<typeof artworkState>>) {
  if (
    !state.ledger ||
    state.ledger.status !== market.ListingStatus.Active ||
    state.ledger.seller !== state.core.owner ||
    state.ledger.price === 0n
  )
    throw new TypeError("A current owner-bound active listing is required");
  return state.ledger;
}

/** Locks the Core asset; sale eligibility is rechecked on chain. */
export async function buildCreateListingTransaction(
  context: MarketplaceTransactionContext,
  accounts: MarketplaceListingAccounts,
  input: MarketplaceListingInput,
) {
  const state = await artworkState(context, accounts, input);
  const price = BigInt(listingPriceSchema.parse(input.price));
  const expiresAt = bounded(input.expiresAt, I64_MAX, "Listing expiry");
  if (
    expiresAt <= state.now ||
    state.actor !== state.core.owner ||
    state.ledger?.status === market.ListingStatus.Active
  )
    throw new TypeError("Seller, listing status or expiry is invalid");
  if (
    state.ledger &&
    ![
      market.ListingStatus.Cancelled,
      market.ListingStatus.Expired,
      market.ListingStatus.Purchased,
    ].includes(state.ledger.status)
  )
    throw new TypeError("Listing status is invalid for relisting");
  if (
    (!state.ledger || state.ledger.completedSales === 0n) &&
    state.actor !== state.record.registeredBy
  )
    throw new TypeError("Primary listing requires the registered original owner");
  const head = await conditionHead(accounts, state.addresses.artwork);
  const instruction = await market.getCreateListingInstructionAsync({
    ...state.addresses,
    conditionReport: head.currentReport,
    seller: createNoopSigner(state.actor),
    price,
    expiresAt,
    expectedRevision: state.revision,
  });
  return Object.freeze({
    ...unsignedMessage(context, instruction),
    addresses: Object.freeze({
      ...state.addresses,
      conditionReport: head.currentReport,
    }),
    nextRevision: state.revision + 1n,
  });
}

async function release(
  context: MarketplaceTransactionContext,
  accounts: MarketplaceArtworkAccounts,
  input: MarketplaceRevisionInput,
  expired: boolean,
) {
  const state = await artworkState(context, accounts, input);
  const ledger = active(state);
  if (expired ? state.now < ledger.expiresAt : state.actor !== ledger.seller)
    throw new TypeError(
      expired ? "Listing has not expired" : "Cancellation requires the recorded seller",
    );
  const args = {
    ...state.addresses,
    actor: createNoopSigner(state.actor),
    expectedRevision: state.revision,
  };
  const instruction = expired
    ? await market.getExpireListingInstructionAsync(args)
    : await market.getCancelListingInstructionAsync(args);
  return Object.freeze({
    ...unsignedMessage(context, instruction),
    addresses: Object.freeze(state.addresses),
    nextRevision: state.revision + 1n,
  });
}
export function buildCancelListingTransaction(
  context: MarketplaceTransactionContext,
  accounts: MarketplaceArtworkAccounts,
  input: MarketplaceRevisionInput,
) {
  return release(context, accounts, input, false);
}
/** Any wallet may recover an expired offer; cancellation still requires its seller. */
export function buildExpireListingTransaction(
  context: MarketplaceTransactionContext,
  accounts: MarketplaceArtworkAccounts,
  input: MarketplaceRevisionInput,
) {
  return release(context, accounts, input, true);
}

async function associatedTokens(owner: Address, mint: Address): Promise<Address> {
  const encoder = getAddressEncoder();
  return (
    await getProgramDerivedAddress({
      programAddress: ASSOCIATED_TOKEN,
      seeds: [encoder.encode(owner), encoder.encode(TOKEN), encoder.encode(mint)],
    })
  )[0];
}
/** Binds reviewed buyer/mint/price/revision; it never signs, fetches or transfers funds. */
export async function buildPurchaseListingTransaction(
  context: MarketplaceTransactionContext,
  accounts: MarketplacePurchaseAccounts,
  input: MarketplacePurchaseInput,
): Promise<PreparedMarketplaceTransaction<MarketplacePurchaseAddresses>> {
  const state = await artworkState(context, accounts, input);
  const ledger = active(state);
  const price = BigInt(listingPriceSchema.parse(input.expectedPrice));
  if (
    nonzeroAddress(input.buyerAddress) !== state.actor ||
    state.actor === ledger.seller ||
    state.now >= ledger.expiresAt ||
    price !== ledger.price ||
    nonzeroAddress(input.paymentMintAddress) !== state.configuration.paymentMint ||
    ledger.completedSales === U64_MAX
  )
    throw new TypeError("Reviewed buyer, mint, price or listing eligibility is stale");
  const [saleTerms, termsBump] = await market.findSaleTermsPda({
    artwork: state.addresses.artwork,
  });
  marketAccount(
    accounts.saleTermsAccount,
    saleTerms,
    market.KathaMarketplaceAccount.ArtworkSaleTerms,
    market.getArtworkSaleTermsSize(),
  );
  const terms = market
    .getArtworkSaleTermsDecoder()
    .decode(accounts.saleTermsAccount.data);
  if (
    terms.version !== 1 ||
    terms.bump !== termsBump ||
    terms.artwork !== state.addresses.artwork ||
    terms.artistPayout !== ledger.artistPayout
  )
    throw new TypeError("Artist payout binding is invalid");
  const head = await conditionHead(accounts, state.addresses.artwork);
  if (
    head.currentReport !== ledger.conditionReport ||
    head.version !== ledger.conditionVersion ||
    !equalBytes(head.currentHash, ledger.conditionHash)
  )
    throw new TypeError("Listed condition commitment is stale");
  // A buyer paying its own payout wallet would alias source/destination under the
  // canonical ATA policy. Such purchases are rejected rather than silently rerouted.
  if (
    state.actor === terms.artistPayout ||
    state.actor === state.configuration.treasury
  )
    throw new TypeError("Buyer cannot alias a payout token account");
  const paymentMint = state.configuration.paymentMint;
  const [buyerTokens, sellerTokens, artistTokens, treasuryTokens] = await Promise.all([
    associatedTokens(state.actor, paymentMint),
    associatedTokens(ledger.seller, paymentMint),
    associatedTokens(terms.artistPayout, paymentMint),
    associatedTokens(state.configuration.treasury, paymentMint),
  ]);
  const addresses = Object.freeze({
    ...state.addresses,
    saleTerms,
    conditionReport: head.currentReport,
    buyer: state.actor,
    seller: ledger.seller,
    artistPayout: terms.artistPayout,
    treasury: state.configuration.treasury,
    paymentMint,
    buyerTokens,
    sellerTokens,
    artistTokens,
    treasuryTokens,
  });
  const instruction = await market.getPurchaseListingInstructionAsync({
    ...addresses,
    buyer: createNoopSigner(state.actor),
    expectedRevision: state.revision,
    expectedPrice: price,
  });
  return Object.freeze({
    ...unsignedMessage(context, instruction),
    addresses,
    nextRevision: state.revision + 1n,
  });
}
