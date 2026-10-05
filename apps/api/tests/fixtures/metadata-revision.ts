import { vi } from "vitest";
import type { MetadataRevisionStore } from "@katha/db";
import {
  CORE_PROGRAM_ADDRESS,
  type MetadataRevisionReader,
  type MetadataRevisionSnapshot,
} from "@katha/solana";
import {
  getArtworkRecordDecoder,
  getArtworkRecordEncoder,
  getMetadataHeadDecoder,
  getMetadataHeadEncoder,
  getMetadataRevisionDecoder,
  getMetadataRevisionEncoder,
} from "@katha/solana/registry";
import { mintFixture } from "./minting.js";
import { createMetadataRevisions } from "../../src/metadata-revisions.js";

export async function metadataRevisionFixture(
  mode: MetadataRevisionSnapshot["mode"] = "UNMINTED",
) {
  const f = await mintFixture();
  const oldHash = "c".repeat(64),
    oldUri = "http://localhost/old.json";
  const oldRevision = getMetadataRevisionDecoder().decode(
    f.accounts.currentRevisionAccount.data,
  );
  const revisionData = new Uint8Array(321);
  revisionData.set(
    getMetadataRevisionEncoder().encode({
      ...oldRevision,
      documentHash: new Uint8Array(32).fill(0xcc),
      uri: oldUri,
    }),
  );
  const base = {
    configAccount: f.accounts.configAccount,
    artworkAccount: f.accounts.artworkAccount,
  };
  const revision = {
    ...base,
    metadataHeadAccount: {
      ...f.accounts.metadataHeadAccount,
      data: Uint8Array.from(
        getMetadataHeadEncoder().encode({
          ...getMetadataHeadDecoder().decode(f.accounts.metadataHeadAccount.data),
          currentHash: new Uint8Array(32).fill(0xcc),
        }),
      ),
    },
    currentRevisionAccount: {
      ...f.accounts.currentRevisionAccount,
      data: revisionData,
    },
  };
  const binding = f.accounts.assetAccount.address;
  const record = getArtworkRecordDecoder().decode(base.artworkAccount.data);
  const artData = new Uint8Array(246);
  artData.set(getArtworkRecordEncoder().encode({ ...record, coreAsset: binding }));
  const str = (value: string) => {
    const b = Buffer.from(value);
    const n = Buffer.alloc(4);
    n.writeUInt32LE(b.length);
    return Buffer.concat([n, b]);
  };
  // Core AssetV1: key, owner, Collection update-authority, name, URI and absent sequence.
  const assetData = Buffer.concat([
    Buffer.from([1]),
    Buffer.from(f.accounts.configAccount.data.slice(8 + 32, 8 + 64)),
    Buffer.from([2]),
    Buffer.from(f.accounts.configAccount.data.slice(8 + 32 * 5, 8 + 32 * 6)),
    str(f.snapshot.artwork.kathaId),
    str(oldUri),
    Buffer.from([0]),
  ]);
  const accounts: MetadataRevisionSnapshot =
    mode === "INITIALIZE"
      ? { ...base, mode }
      : mode === "UNMINTED"
        ? { ...revision, mode }
        : {
            ...revision,
            mode,
            artworkAccount: { ...base.artworkAccount, data: artData },
            collectionAccount: f.accounts.collectionAccount,
            assetAccount: {
              ...base.artworkAccount,
              address: binding,
              programAddress: CORE_PROGRAM_ADDRESS,
              data: assetData,
              space: BigInt(assetData.length),
            },
          };
  const load = vi.fn<MetadataRevisionStore["load"]>(async () => f.snapshot);
  const store: MetadataRevisionStore = { load, operations: () => ({ save: f.save }) };
  const readChain = vi.fn<MetadataRevisionReader>(async () => accounts);
  const request = {
    idempotencyKey: "synthetic-metadata-revision",
    expectedUpdatedAt: f.request.expectedUpdatedAt,
    metadataVersionId: f.request.metadataVersionId,
    expectedMetadataVersion: mode === "INITIALIZE" ? 0 : 1,
    expectedMetadataHash: mode === "INITIALIZE" ? null : oldHash,
    supportedTransactionVersions: [0],
  };
  const service = createMetadataRevisions(
    store,
    f.authorization,
    readChain,
    f.chain,
    { ...f.storage, read: f.read },
    "localnet",
  );
  return { ...f, accounts, load, readChain, request, service, oldUri, oldHash };
}
