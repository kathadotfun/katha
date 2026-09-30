import {
  deserializeAssetV1,
  deserializeCollectionV1,
  getCreateCollectionV2InstructionDataSerializer,
  MPL_CORE_PROGRAM_ID,
} from "@metaplex-foundation/mpl-core";
import { lamports, publicKey } from "@metaplex-foundation/umi";
import { AccountRole, address } from "@solana/kit";
import type { Address, EncodedAccount, Instruction } from "@solana/kit";
import { assertOwnedEncodedAccount } from "./client.js";

export const CORE_PROGRAM_ADDRESS = address(MPL_CORE_PROGRAM_ID);
const SYSTEM_PROGRAM_ADDRESS = address("11111111111111111111111111111111");

export interface CoreCollectionInput {
  collectionAddress: Address;
  payerAddress: Address;
  updateAuthorityAddress: Address;
  name: string;
  uri: string;
}

export interface CoreCollectionView {
  address: Address;
  updateAuthority: Address;
  name: string;
  uri: string;
}

export interface CoreAssetView {
  address: Address;
  owner: Address;
  collection: Address;
  name: string;
  uri: string;
}

function checkedAddress(value: Address): Address {
  return address(value);
}

function checkedText(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new TypeError(
      `${label} must be nonempty text without surrounding whitespace`,
    );
  }
  return value;
}

/** The collection account and payer must sign the resulting unsigned instruction. */
export function buildCreateCoreCollectionInstruction(
  input: CoreCollectionInput,
): Instruction {
  const collection = checkedAddress(input.collectionAddress);
  const payer = checkedAddress(input.payerAddress);
  const updateAuthority = checkedAddress(input.updateAuthorityAddress);
  if (collection === payer || collection === updateAuthority) {
    throw new TypeError("Collection address must be distinct from payer and authority");
  }
  const name = checkedText(input.name, "Collection name");
  const uri = checkedText(input.uri, "Collection URI");
  let parsedUri: URL;
  try {
    parsedUri = new URL(uri);
  } catch {
    throw new TypeError("Collection URI must be an absolute URL");
  }
  if (parsedUri.protocol !== "https:" || parsedUri.username || parsedUri.password) {
    throw new TypeError("Collection URI must be public HTTPS metadata");
  }
  return {
    programAddress: CORE_PROGRAM_ADDRESS,
    accounts: [
      { address: collection, role: AccountRole.WRITABLE_SIGNER },
      { address: updateAuthority, role: AccountRole.READONLY },
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: getCreateCollectionV2InstructionDataSerializer().serialize({ name, uri }),
  };
}

function assertCoreAccount(
  account: unknown,
  expectedAddress: Address,
): asserts account is EncodedAccount {
  assertOwnedEncodedAccount(
    account,
    checkedAddress(expectedAddress),
    CORE_PROGRAM_ADDRESS,
    1,
  );
  if (account.executable) {
    throw new TypeError("Core data account cannot be executable");
  }
}

function umiAccount(account: EncodedAccount) {
  return {
    publicKey: publicKey(account.address),
    owner: publicKey(account.programAddress),
    lamports: lamports(account.lamports),
    executable: account.executable,
    data: Uint8Array.from(account.data),
  };
}

export function readCoreCollection(
  account: unknown,
  expectedAddress: Address,
  expectedAuthority: Address,
): CoreCollectionView {
  assertCoreAccount(account, expectedAddress);
  const collection = deserializeCollectionV1(umiAccount(account));
  if (String(collection.updateAuthority) !== checkedAddress(expectedAuthority)) {
    throw new TypeError("Core collection update authority mismatch");
  }
  return {
    address: expectedAddress,
    updateAuthority: address(collection.updateAuthority),
    name: collection.name,
    uri: collection.uri,
  };
}

/** The registry supplies the expected asset and collection; neither is inferred from metadata. */
export function readCoreAsset(
  account: unknown,
  expectedAsset: Address,
  expectedCollection: Address,
): CoreAssetView {
  assertCoreAccount(account, expectedAsset);
  const asset = deserializeAssetV1(umiAccount(account));
  if (
    asset.updateAuthority.type !== "Collection" ||
    String(asset.updateAuthority.address) !== checkedAddress(expectedCollection)
  ) {
    throw new TypeError("Core asset collection mismatch");
  }
  return {
    address: expectedAsset,
    owner: address(asset.owner),
    collection: expectedCollection,
    name: asset.name,
    uri: asset.uri,
  };
}
