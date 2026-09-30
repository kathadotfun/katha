import {
  getCreateCollectionV2InstructionDataSerializer,
  Key,
} from "@metaplex-foundation/mpl-core";
import { getAssetV1AccountDataSerializer } from "@metaplex-foundation/mpl-core/dist/src/generated/types/assetV1AccountData.js";
import { getCollectionV1AccountDataSerializer } from "@metaplex-foundation/mpl-core/dist/src/generated/types/collectionV1AccountData.js";
import { AccountRole, address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  buildCreateCoreCollectionInstruction,
  CORE_PROGRAM_ADDRESS,
  readCoreAsset,
  readCoreCollection,
} from "../src/core.js";

const collection = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const asset = address("Vote111111111111111111111111111111111111111");
const payer = address("SysvarRent111111111111111111111111111111111");
const authority = address("BPFLoaderUpgradeab1e11111111111111111111111");
const owner = address("11111111111111111111111111111111");
const uri = "https://katha.fun/metadata/collection.json";

function encodedAccount(accountAddress: typeof collection, data: Uint8Array) {
  return {
    exists: true,
    address: accountAddress,
    programAddress: CORE_PROGRAM_ADDRESS,
    data,
    space: BigInt(data.length),
    lamports: 1000n,
    executable: false,
  };
}

const collectionData = () =>
  getCollectionV1AccountDataSerializer().serialize({
    key: Key.CollectionV1,
    updateAuthority: authority,
    name: "Katha",
    uri,
    numMinted: 1,
    currentSize: 1,
  });

const assetData = (collectionAddress: string = collection) =>
  getAssetV1AccountDataSerializer().serialize({
    key: Key.AssetV1,
    owner,
    updateAuthority: { __kind: "Collection", fields: [collectionAddress] },
    name: "Artwork",
    uri: "https://katha.fun/metadata/artwork.json",
    seq: null,
  });

describe("Core collection builder", () => {
  it("creates an unsigned Core V2 instruction with the required signers", () => {
    const instruction = buildCreateCoreCollectionInstruction({
      collectionAddress: collection,
      payerAddress: payer,
      updateAuthorityAddress: authority,
      name: "Katha",
      uri,
    });
    expect(instruction.programAddress).toBe(CORE_PROGRAM_ADDRESS);
    expect(instruction.accounts).toEqual([
      { address: collection, role: AccountRole.WRITABLE_SIGNER },
      { address: authority, role: AccountRole.READONLY },
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: owner, role: AccountRole.READONLY },
    ]);
    expect(
      getCreateCollectionV2InstructionDataSerializer().deserialize(
        instruction.data!,
      )[0],
    ).toMatchObject({
      discriminator: 21,
      name: "Katha",
      uri,
    });
  });

  it("rejects ambiguous authority and unsafe metadata inputs", () => {
    const input = {
      collectionAddress: collection,
      payerAddress: payer,
      updateAuthorityAddress: authority,
      name: "Katha",
      uri,
    };
    expect(() =>
      buildCreateCoreCollectionInstruction({ ...input, payerAddress: collection }),
    ).toThrow();
    expect(() =>
      buildCreateCoreCollectionInstruction({ ...input, name: " " }),
    ).toThrow();
    expect(() =>
      buildCreateCoreCollectionInstruction({ ...input, uri: "http://example.com" }),
    ).toThrow();
    expect(() =>
      buildCreateCoreCollectionInstruction({
        ...input,
        uri: "https://u:p@example.com",
      }),
    ).toThrow();
  });
});

describe("Core account boundary", () => {
  it("reads a verified collection and asset relationship", () => {
    expect(
      readCoreCollection(
        encodedAccount(collection, collectionData()),
        collection,
        authority,
      ),
    ).toMatchObject({
      address: collection,
      updateAuthority: authority,
      name: "Katha",
    });
    expect(
      readCoreAsset(encodedAccount(asset, assetData()), asset, collection),
    ).toMatchObject({
      address: asset,
      collection,
      owner,
      name: "Artwork",
    });
  });

  it("rejects wrong account owners, addresses, authority, and collection substitution", () => {
    const validAsset = encodedAccount(asset, assetData());
    expect(() =>
      readCoreAsset({ ...validAsset, programAddress: payer }, asset, collection),
    ).toThrow();
    expect(() => readCoreAsset(validAsset, collection, collection)).toThrow();
    expect(() => readCoreAsset(validAsset, asset, authority)).toThrow();
    expect(() =>
      readCoreAsset(encodedAccount(asset, assetData(authority)), asset, collection),
    ).toThrow();
    expect(() =>
      readCoreCollection(
        encodedAccount(collection, collectionData()),
        collection,
        owner,
      ),
    ).toThrow();
  });

  it("rejects wrong discriminators, truncated data, and executable accounts", () => {
    expect(() =>
      readCoreAsset(encodedAccount(asset, collectionData()), asset, collection),
    ).toThrow();
    expect(() =>
      readCoreCollection(
        encodedAccount(collection, assetData()),
        collection,
        authority,
      ),
    ).toThrow();
    expect(() =>
      readCoreAsset(encodedAccount(asset, new Uint8Array([1])), asset, collection),
    ).toThrow();
    expect(() =>
      readCoreAsset(
        { ...encodedAccount(asset, assetData()), executable: true },
        asset,
        collection,
      ),
    ).toThrow();
  });
});
