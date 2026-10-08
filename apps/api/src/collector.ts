import type { CollectorStore } from "@katha/db";
import {
  collectorAccountResponseSchema,
  collectorCollectionResponseSchema,
  walletSessionSchema,
  type CollectorCollectionQuery,
} from "@katha/shared";
import { findArtworkPda, findAssetPda } from "@katha/solana/registry";
import type { WalletSessionBoundary } from "./wallet-session.js";
import { projectProvenanceIndexing } from "./artwork-provenance.js";
import { DomainError } from "./errors.js";

export function createCollector(
  store: CollectorStore,
  sessions: WalletSessionBoundary,
  cluster: "localnet" | "devnet",
) {
  async function authenticate(authorization: string | undefined) {
    const session = walletSessionSchema.parse(
      await sessions.authenticate(authorization),
    );
    if (session.cluster !== cluster) throw new DomainError("UNAUTHENTICATED");
    return session;
  }
  return {
    async account(authorization: string | undefined) {
      const session = await authenticate(authorization);
      const record = await store.account(session.walletAddress);
      return collectorAccountResponseSchema.parse({
        session,
        indexedArtworkCount: record.indexedArtworkCount,
        evaluatedAt: record.evaluatedAt.toISOString(),
      });
    },
    async collection(
      authorization: string | undefined,
      query: CollectorCollectionQuery,
    ) {
      const session = await authenticate(authorization);
      const record = await store.collection(session.walletAddress, query);
      const items = [];
      for (const item of record.items.slice(0, query.limit)) {
        const [artwork] = await findArtworkPda({ kathaId: item.artwork.kathaId });
        const [asset] = await findAssetPda({ artwork });
        if (
          item.owner.ownerWallet !== session.walletAddress ||
          item.owner.cluster.toLowerCase() !== cluster ||
          item.owner.assetAddress !== asset ||
          item.mint?.assetAddress !== asset ||
          item.registration?.payload.artwork !== artwork ||
          item.mint?.payload.artwork !== artwork ||
          item.mint.payload.collection !== item.registration.payload.collection ||
          (item.network !== null &&
            item.network.collection !== item.mint.payload.collection) ||
          item.ownershipEvent.assetAddress !== asset ||
          item.ownershipEvent.cluster !== item.owner.cluster ||
          !["OWNERSHIP", "SALE"].includes(item.ownershipEvent.kind) ||
          (item.ownershipEvent.kind === "SALE"
            ? item.ownershipEvent.payload.buyerWallet
            : item.ownershipEvent.payload.ownerWallet) !== session.walletAddress
        )
          throw new Error("Invalid holding binding");
        const state = item.custody
          ? ["UNKNOWN", "KATHA_HELD", "COLLECTOR_HELD", "IN_TRANSIT"][
              Number(item.custody.payload.toState)
            ]
          : "UNKNOWN";
        items.push({
          artwork: {
            kathaId: item.artwork.kathaId,
            category: item.artwork.category,
            title: item.artwork.title,
            creationYear: item.artwork.creationYear,
            artist: {
              id: item.artist.id,
              slug: item.artist.slug,
              displayName: item.artist.displayName,
            },
            heroImage: item.heroImage
              ? {
                  id: item.heroImage.id,
                  contentHash: item.heroImage.contentHash,
                  mimeType: item.heroImage.mimeType,
                  altText: item.heroImage.altText,
                }
              : null,
          },
          assetAddress: asset,
          ownerWallet: session.walletAddress,
          ownershipSource: "INDEXED_CORE",
          custody: {
            state,
            source: item.custody ? "FINALIZED_REGISTRY" : "UNKNOWN",
            observedAt: item.custody?.chainRecordedAt.toISOString() ?? null,
          },
          indexing: projectProvenanceIndexing(item),
        });
      }
      return collectorCollectionResponseSchema.parse({
        walletAddress: session.walletAddress,
        cluster,
        evaluatedAt: record.evaluatedAt.toISOString(),
        items,
        pagination: { ...query, hasMore: record.items.length > query.limit },
      });
    },
  };
}
export type CollectorBoundary = ReturnType<typeof createCollector>;
