import type { PublicProvenanceStore } from "@katha/db";
import {
  artworkProvenanceResponseSchema,
  publicProvenanceEventSchema,
  conditionGradeSchema,
  conditionReasonSchema,
  physicalCustodyStateSchema,
  physicalCustodyTransitionSchema,
  type ArtworkProvenanceQuery,
} from "@katha/shared";
import { CORE_PROGRAM_ADDRESS } from "@katha/solana";
import {
  KATHA_REGISTRY_PROGRAM_ADDRESS,
  findArtworkPda,
  findAssetPda,
  findReportPda,
  findTransitionCustodyTransitionPda,
  findReviseMintedMetadataRevisionPda,
} from "@katha/solana/registry";
import { z } from "zod";
import { DomainError } from "./errors.js";

type Snapshot = NonNullable<Awaited<ReturnType<PublicProvenanceStore["find"]>>>;
type Event = Snapshot["events"][number];
// The database's clock is used for all comparisons in a repeatable read snapshot.
const observationMaxAgeMs = 30_000;
function seconds(value: unknown) {
  const s = z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/)
    .max(16)
    .parse(value);
  const ms = BigInt(s) * 1000n;
  if (ms > 253402300799000n) throw new Error("Invalid event timestamp");
  return new Date(Number(ms)).toISOString();
}
function enumValue<T extends string>(options: readonly T[], value: unknown): T {
  const i = z
    .number()
    .int()
    .min(0)
    .max(options.length - 1)
    .parse(value);
  return options[i]!;
}
async function project(
  event: Event,
  record: Snapshot,
  artwork: string,
  asset: string,
  collection: string,
) {
  if (event.cluster !== record.cluster || event.artworkId !== record.id)
    throw new Error("Unexpected event scope");
  const p = event.payload;
  const isTransfer = p.name === "CoreTransfer";
  if (
    event.programAddress !==
      (isTransfer ? CORE_PROGRAM_ADDRESS : KATHA_REGISTRY_PROGRAM_ADDRESS) ||
    event.kind !== (isTransfer || p.name === "ArtworkMinted" ? "OWNERSHIP" : "REGISTRY")
  )
    throw new Error("Unexpected event source");
  if (isTransfer) {
    if (!record.mint) throw new Error("Missing mint binding");
    if (
      p.asset !== asset ||
      event.assetAddress !== asset ||
      p.collection !== collection ||
      p.ownerWallet !== p.newOwner
    )
      throw new Error("Unexpected transfer binding");
  } else if (p.artwork !== artwork || p.kathaId !== record.kathaId)
    throw new Error("Unexpected artwork binding");
  const base = {
    id: event.id,
    programAddress: event.programAddress,
    transaction: {
      signature: event.signature,
      slot: event.slot.toString(),
      recordedAt: event.chainRecordedAt.toISOString(),
    },
    position: {
      transactionIndex: event.transactionIndex,
      outerInstructionIndex: event.outerInstructionIndex,
      innerInstructionIndex: event.innerInstructionIndex,
      eventIndex: event.eventIndex,
    },
  };
  let projected: unknown;
  switch (p.name) {
    case "ArtworkRegistered":
      if (
        p.artistId !== record.artist.id ||
        p.creatorWallet !== record.creatorWallet ||
        p.authorshipEvidenceHash !== record.authorshipEvidenceHash ||
        p.creationYear !== record.creationYear ||
        p.category !== record.category ||
        p.collection !== collection
      )
        throw new Error("Unexpected attribution");
      projected = {
        ...base,
        type: "REGISTRATION",
        data: {
          registryRecordAddress: p.artwork,
          artistId: p.artistId,
          creatorWallet: p.creatorWallet,
          authorshipEvidenceHash: p.authorshipEvidenceHash,
          registeredBy: p.registeredBy,
          registeredAt: seconds(p.registeredAt),
        },
      };
      break;
    case "ArtworkVerified":
      if (p.authorshipEvidenceHash !== record.authorshipEvidenceHash)
        throw new Error("Unexpected evidence commitment");
      projected = {
        ...base,
        type: "VERIFICATION",
        data: {
          authorshipEvidenceHash: p.authorshipEvidenceHash,
          verifierWallet: p.verifier,
          verifiedAt: seconds(p.verifiedAt),
        },
      };
      break;
    case "MetadataCommitted": {
      const version = z.number().int().min(1).max(4294967295).parse(p.version);
      if (
        p.revision !==
        (
          await findReviseMintedMetadataRevisionPda({
            artwork: (await findArtworkPda({ kathaId: record.kathaId }))[0],
            nextVersion: version,
          })
        )[0]
      )
        throw new Error("Unexpected revision binding");
      projected = {
        ...base,
        type: "METADATA",
        data: {
          version,
          documentHash: p.documentHash,
          revisionAddress: p.revision,
          committedBy: p.committedBy,
          committedAt: seconds(p.committedAt),
        },
      };
      break;
    }
    case "ConditionRecorded": {
      const reportId = z
        .string()
        .regex(/^[0-9a-f]{32}$/)
        .parse(p.reportId);
      if (
        p.report !==
        (await findReportPda({ reportId: Buffer.from(reportId, "hex") }))[0]
      )
        throw new Error("Unexpected report binding");
      const inspectedAt = seconds(p.inspectedAt),
        recordedAt = seconds(p.recordedAt);
      if (inspectedAt > recordedAt) throw new Error("Invalid inspection time");
      projected = {
        ...base,
        type: "CONDITION",
        data: {
          version: p.version,
          reportAddress: p.report,
          documentHash: p.reportHash,
          grade: enumValue(conditionGradeSchema.options, p.grade),
          reason: enumValue(conditionReasonSchema.options, p.reason),
          verifierWallet: p.verifier,
          inspectedAt,
          recordedAt,
        },
      };
      break;
    }
    case "CustodyUpdated": {
      const revision = z
        .string()
        .regex(/^[1-9][0-9]*$/)
        .max(20)
        .parse(p.revision);
      if (
        p.transition !==
        (
          await findTransitionCustodyTransitionPda({
            artwork: (await findArtworkPda({ kathaId: record.kathaId }))[0],
            nextRevision: BigInt(revision),
          })
        )[0]
      )
        throw new Error("Unexpected custody binding");
      physicalCustodyTransitionSchema.parse({
        action: enumValue(
          physicalCustodyTransitionSchema.options.map((s) => s.shape.action.value),
          p.action,
        ),
        from: enumValue(physicalCustodyStateSchema.options, p.fromState),
        to: enumValue(physicalCustodyStateSchema.options, p.toState),
      });
      projected = {
        ...base,
        type: "CUSTODY",
        data: {
          revision: p.revision,
          fromState: enumValue(physicalCustodyStateSchema.options, p.fromState),
          toState: enumValue(physicalCustodyStateSchema.options, p.toState),
          attestedBy: p.attestedBy,
          recordedAt: seconds(p.recordedAt),
        },
      };
      break;
    }
    case "ArtworkMinted":
      if (
        p.asset !== asset ||
        event.assetAddress !== asset ||
        p.collection !== collection ||
        p.ownerWallet !== p.initialOwner
      )
        throw new Error("Unexpected mint binding");
      projected = {
        ...base,
        type: "MINT",
        data: {
          assetAddress: p.asset,
          initialOwner: p.initialOwner,
          metadataVersion: p.metadataVersion,
          metadataHash: p.metadataHash,
          mintedBy: p.mintedBy,
          mintedAt: seconds(p.mintedAt),
        },
      };
      break;
    case "CoreTransfer":
      projected = {
        ...base,
        type: "TRANSFER",
        data: {
          assetAddress: p.asset,
          newOwner: p.newOwner,
          authorityWallet: p.authority,
        },
      };
      break;
    default:
      throw new Error("Unknown provenance event");
  }
  return publicProvenanceEventSchema.parse(projected);
}
function indexing(record: Snapshot) {
  const network = record.network;
  const rec = record.reconciliation;
  const staleSource =
    rec &&
    (!record.owner ||
      rec.sourceEventId !== record.owner.sourceEventId ||
      rec.indexedOwner !== record.owner.ownerWallet);
  const recent = (d: Date) =>
    d.getTime() <= record.evaluatedAt.getTime() &&
    record.evaluatedAt.getTime() - d.getTime() <= observationMaxAgeMs;
  const streams = [KATHA_REGISTRY_PROGRAM_ADDRESS, CORE_PROGRAM_ADDRESS].map(
    (programAddress) => {
      const c = record.checkpoints.find((c) => c.programAddress === programAddress);
      return {
        programAddress,
        checkpoint: c
          ? {
              fromSlot: c.fromSlot.toString(),
              scannedThroughSlot: c.scannedThroughSlot?.toString() ?? null,
              lagSlots:
                network &&
                c.scannedThroughSlot !== null &&
                c.scannedThroughSlot <= network.finalizedSlot
                  ? (network.finalizedSlot - c.scannedThroughSlot).toString()
                  : null,
              gapFromSlot: c.gapFromSlot?.toString() ?? null,
              gapThroughSlot: c.gapThroughSlot?.toString() ?? null,
              gapReason: c.gapReason,
              updatedAt: c.updatedAt.toISOString(),
            }
          : null,
      };
    },
  );
  const staleCheck =
    rec &&
    (staleSource ||
      !recent(rec.checkedAt) ||
      !network ||
      rec.observedSlot < network.finalizedSlot);
  let status: "UNKNOWN" | "GAP_DETECTED" | "LAGGING" | "STALE" | "AT_OBSERVED_HEAD" =
    "UNKNOWN";
  if (
    network?.blocked ||
    record.checkpoints.some((c) => c.gapFromSlot !== null) ||
    (rec && !staleSource && rec.status !== "MATCH")
  )
    status = "GAP_DETECTED";
  else if (
    network &&
    streams.every(
      (s) => s.checkpoint?.scannedThroughSlot !== null && s.checkpoint != null,
    ) &&
    record.registration &&
    record.checkpoints.every((c) => c.fromSlot <= record.registration!.slot) &&
    record.mint &&
    record.owner &&
    rec
  ) {
    if (streams.some((s) => s.checkpoint?.lagSlots === null)) status = "UNKNOWN";
    else if (streams.some((s) => BigInt(s.checkpoint!.lagSlots!) > 0n))
      status = "LAGGING";
    else if (
      !recent(network.updatedAt) ||
      record.checkpoints.some((c) => !recent(c.updatedAt)) ||
      staleCheck
    )
      status = "STALE";
    else status = "AT_OBSERVED_HEAD";
  }
  return {
    status,
    evaluatedAt: record.evaluatedAt.toISOString(),
    network: network
      ? {
          genesisHash: network.genesisHash,
          collectionAddress: network.collection,
          observedFinalizedSlot: network.finalizedSlot.toString(),
          observedAt: network.updatedAt.toISOString(),
          blocked: network.blocked,
        }
      : null,
    streams,
    ownerCheck: rec
      ? {
          status: staleCheck ? "STALE" : rec.status,
          observedSlot: rec.observedSlot.toString(),
          checkedAt: rec.checkedAt.toISOString(),
        }
      : null,
  };
}
export function createArtworkProvenance(store: PublicProvenanceStore) {
  return {
    async history(kathaId: string, query: ArtworkProvenanceQuery) {
      const record = await store.find(kathaId, query);
      if (!record) throw new DomainError("NOT_FOUND");
      if (record.kathaId !== kathaId) throw new Error("Unexpected identity");
      const [artwork] = await findArtworkPda({ kathaId });
      const [asset] = await findAssetPda({ artwork });
      const registration = record.registration;
      const collection = registration
        ? z.string().parse(registration.payload.collection)
        : null;
      if (registration && collection)
        await project(registration, record, artwork, asset, collection);
      if (record.network && collection && record.network.collection !== collection)
        throw new Error("Unexpected collection binding");
      if (record.mint) {
        if (!collection) throw new Error("Missing registration binding");
        await project(record.mint, record, artwork, asset, collection);
        if (record.owner?.assetAddress !== asset)
          throw new Error("Unexpected ownership binding");
      }
      if (record.events.length && !collection)
        throw new Error("Missing registration binding");
      const items = await Promise.all(
        record.events
          .slice(0, query.limit)
          .map((e) => project(e, record, artwork, asset, collection!)),
      );
      return artworkProvenanceResponseSchema.parse({
        kathaId,
        attribution: {
          artist: {
            id: record.artist.id,
            slug: record.artist.slug,
            displayName: record.artist.displayName,
          },
          creatorWallet: record.creatorWallet,
        },
        chain: {
          cluster: record.cluster,
          registryRecordAddress: registration ? artwork : null,
          collectionAddress: collection,
          coreAssetAddress: record.mint ? asset : null,
        },
        items,
        pagination: {
          limit: query.limit,
          offset: query.offset,
          hasMore: record.events.length > query.limit,
        },
        indexing: indexing(record),
      });
    },
  };
}
export type ArtworkProvenanceBoundary = ReturnType<typeof createArtworkProvenance>;
