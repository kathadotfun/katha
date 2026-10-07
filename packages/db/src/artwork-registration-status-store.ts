import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "./connection.js";
import { artworks } from "./schema/artworks.js";
import {
  blockchainOperations,
  transactionReceipts,
} from "./schema/blockchain-operations.js";
import { indexedEvents } from "./schema/blockchain-read-models.js";
function createArtworkOperationStatusStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET",
  kind:
    | "REGISTER_ARTWORK"
    | "VERIFY_ARTWORK"
    | "RECORD_CONDITION"
    | "UPDATE_CUSTODY"
    | "MINT_ARTWORK"
    | "REVISE_METADATA",
  reportHash?: string,
  metadataId?: string,
) {
  return async (kathaId: string) =>
    db.transaction(async (tx) => {
      const operations = await tx
        .select({
          id: blockchainOperations.id,
          programAddress: blockchainOperations.programAddress,
          status: blockchainOperations.status,
        })
        .from(blockchainOperations)
        .innerJoin(artworks, eq(artworks.id, blockchainOperations.artworkId))
        .where(
          and(
            eq(artworks.kathaId, kathaId),
            eq(blockchainOperations.cluster, cluster),
            eq(blockchainOperations.kind, kind),
            ...(metadataId
              ? [
                  sql`exists (select 1 from operation_preparations as preparation where preparation.operation_id = ${blockchainOperations.id} and preparation.canonical_request::jsonb -> 'parameters' ->> 'metadataVersionId' = ${metadataId})`,
                ]
              : []),
            ...(reportHash
              ? [sql`${reportHash} = any(${blockchainOperations.expectedHashes})`]
              : []),
          ),
        )
        .orderBy(desc(blockchainOperations.createdAt), desc(blockchainOperations.id));
      const finalized = operations.find((row) => row.status === "FINALIZED");
      const [{ receipt, programAddress } = {}] = await tx
        .select({
          receipt: transactionReceipts,
          programAddress: blockchainOperations.programAddress,
        })
        .from(transactionReceipts)
        .innerJoin(
          blockchainOperations,
          eq(blockchainOperations.id, transactionReceipts.operationId),
        )
        .innerJoin(artworks, eq(artworks.id, blockchainOperations.artworkId))
        .where(
          and(
            eq(artworks.kathaId, kathaId),
            eq(blockchainOperations.cluster, cluster),
            eq(transactionReceipts.cluster, cluster),
            eq(blockchainOperations.kind, kind),
            ...(metadataId
              ? [
                  sql`(${transactionReceipts.status} = 'UNKNOWN' or exists (select 1 from operation_preparations as preparation where preparation.operation_id = ${blockchainOperations.id} and preparation.canonical_request::jsonb -> 'parameters' ->> 'metadataVersionId' = ${metadataId}))`,
                ]
              : []),
            ...(reportHash
              ? [sql`${reportHash} = any(${blockchainOperations.expectedHashes})`]
              : []),
          ),
        )
        .orderBy(
          kind === "UPDATE_CUSTODY" || kind === "REVISE_METADATA"
            ? sql`case ${transactionReceipts.status} when 'UNKNOWN' then 0 else 1 end`
            : sql`case ${transactionReceipts.status} when 'FINALIZED' then 0 when 'UNKNOWN' then 1 else 2 end`,
          desc(transactionReceipts.observedAt),
          desc(transactionReceipts.id),
        )
        .limit(1);
      // A newer unsigned preparation must not hide an older unresolved signed attempt.
      const [unknown] = await tx
        .select({ id: transactionReceipts.id })
        .from(transactionReceipts)
        .innerJoin(
          blockchainOperations,
          eq(blockchainOperations.id, transactionReceipts.operationId),
        )
        .innerJoin(artworks, eq(artworks.id, blockchainOperations.artworkId))
        .where(
          and(
            eq(artworks.kathaId, kathaId),
            eq(blockchainOperations.cluster, cluster),
            eq(transactionReceipts.cluster, cluster),
            eq(blockchainOperations.kind, kind),
            ...(reportHash
              ? [sql`${reportHash} = any(${blockchainOperations.expectedHashes})`]
              : []),
            eq(transactionReceipts.status, "UNKNOWN"),
          ),
        )
        .limit(1);
      const [event] =
        receipt?.status === "FINALIZED"
          ? await tx
              .select({ id: indexedEvents.id })
              .from(indexedEvents)
              .innerJoin(artworks, eq(artworks.id, indexedEvents.artworkId))
              .where(
                and(
                  eq(artworks.kathaId, kathaId),
                  eq(indexedEvents.cluster, cluster),
                  eq(indexedEvents.programAddress, programAddress ?? ""),
                  eq(indexedEvents.signature, receipt.signature),
                  eq(indexedEvents.kind, "REGISTRY"),
                ),
              )
              .limit(1)
          : [];
      return {
        finalized: Boolean(finalized) || receipt?.status === "FINALIZED",
        unresolved: Boolean(unknown),
        receipt: receipt
          ? {
              status: receipt.status,
              signature: receipt.signature,
              slot: receipt.slot?.toString() ?? null,
              indexed: Boolean(event),
            }
          : null,
      };
    });
}

export function createArtworkRegistrationStatusStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET",
) {
  return createArtworkOperationStatusStore(db, cluster, "REGISTER_ARTWORK");
}
export function createArtworkVerificationStatusStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET",
) {
  return createArtworkOperationStatusStore(db, cluster, "VERIFY_ARTWORK");
}

export function createConditionAttestationStatusStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET",
) {
  return (kathaId: string, reportHash: string) =>
    createArtworkOperationStatusStore(
      db,
      cluster,
      "RECORD_CONDITION",
      reportHash,
    )(kathaId);
}

export function createCustodyOperationStatusStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET",
) {
  return createArtworkOperationStatusStore(db, cluster, "UPDATE_CUSTODY");
}

export function createArtworkMintStatusStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET",
) {
  return createArtworkOperationStatusStore(db, cluster, "MINT_ARTWORK");
}

export function createMetadataRevisionStatusStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET",
) {
  return (kathaId: string, metadataId: string) =>
    createArtworkOperationStatusStore(
      db,
      cluster,
      "REVISE_METADATA",
      undefined,
      metadataId,
    )(kathaId);
}
