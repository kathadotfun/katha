import { and, eq, desc, sql } from "drizzle-orm";
import type { Database } from "./connection.js";

import { artworks } from "./schema/artworks.js";
import { fulfillmentRequests } from "./schema/custody-fulfillment.js";
import { createOperationPreparationStore } from "./operation-preparation-store.js";
type Request = typeof fulfillmentRequests.$inferSelect;
type Artwork = typeof artworks.$inferSelect;
type CreateInput = Pick<
  Request,
  | "kind"
  | "recipientName"
  | "contactEmail"
  | "contactPhone"
  | "addressLines"
  | "city"
  | "region"
  | "postalCode"
  | "countryCode"
  | "deliveryInstructions"
> & { requestId: string };
type UpdateInput = {
  expectedUpdatedAt: string;
  status: Exclude<Request["status"], "REQUESTED">;
  courier?: string | null | undefined;
  trackingReference?: string | null | undefined;
};
export function createCustodyOperationStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET" = "LOCALNET",
) {
  return {
    async listRequests(
      artworkId: string,
      pagination: { limit: number; offset: number },
    ) {
      const rows = await db
        .select()
        .from(fulfillmentRequests)
        .where(eq(fulfillmentRequests.artworkId, artworkId))
        .orderBy(desc(fulfillmentRequests.createdAt), desc(fulfillmentRequests.id))
        .limit(pagination.limit + 1)
        .offset(pagination.offset);
      return {
        items: rows.slice(0, pagination.limit),
        hasMore: rows.length > pagination.limit,
      };
    },
    async load(kathaId: string, fulfillmentId?: string) {
      const [artwork] = await db
        .select()
        .from(artworks)
        .where(eq(artworks.kathaId, kathaId));
      if (!artwork) return null;
      const [request] = fulfillmentId
        ? await db
            .select()
            .from(fulfillmentRequests)
            .where(
              and(
                eq(fulfillmentRequests.id, fulfillmentId),
                eq(fulfillmentRequests.artworkId, artwork.id),
              ),
            )
        : [];
      return { artwork, request: request ?? null };
    },
    async findRequest(id: string) {
      const [row] = await db
        .select({ request: fulfillmentRequests, artwork: artworks })
        .from(fulfillmentRequests)
        .innerJoin(artworks, eq(artworks.id, fulfillmentRequests.artworkId))
        .where(eq(fulfillmentRequests.id, id));
      return row ?? null;
    },
    async create(
      expected: typeof artworks.$inferSelect,
      requesterWallet: string,
      input: CreateInput,
    ) {
      return db.transaction(async (tx) => {
        const [artwork] = await tx
          .select()
          .from(artworks)
          .where(eq(artworks.id, expected.id))
          .for("update");
        if (
          !artwork ||
          artwork.updatedAt.toISOString() !== expected.updatedAt.toISOString()
        )
          return null;
        const { requestId, ...details } = input;
        const values = {
          id: requestId,
          artworkId: artwork.id,
          requesterWallet,
          ...details,
        };
        await tx.insert(fulfillmentRequests).values(values).onConflictDoNothing();
        const [row] = await tx
          .select()
          .from(fulfillmentRequests)
          .where(eq(fulfillmentRequests.id, requestId))
          .for("share");
        if (
          !row ||
          Object.entries(values).some(
            ([key, value]) =>
              JSON.stringify(row[key as keyof typeof row]) !== JSON.stringify(value),
          )
        )
          return null;
        return row;
      });
    },
    async update(
      expected: { artwork: Artwork; request: Request },
      handler: string,
      input: UpdateInput,
    ) {
      return db.transaction(async (tx) => {
        const [artwork] = await tx
          .select()
          .from(artworks)
          .where(eq(artworks.id, expected.artwork.id))
          .for("update");
        const [request] = await tx
          .select()
          .from(fulfillmentRequests)
          .where(eq(fulfillmentRequests.id, expected.request.id))
          .for("update");
        if (
          !artwork ||
          !request ||
          artwork.updatedAt.toISOString() !==
            expected.artwork.updatedAt.toISOString() ||
          request.updatedAt.toISOString() !== input.expectedUpdatedAt ||
          request.status !== expected.request.status
        )
          return null;
        const allowed: Record<Request["status"], readonly string[]> = {
          REQUESTED: ["APPROVED", "CANCELLED"],
          APPROVED: ["DISPATCHED", "CANCELLED"],
          DISPATCHED: ["RECEIVED"],
          RECEIVED: [],
          CANCELLED: [],
        };
        if (!allowed[request.status].includes(input.status)) return null;
        // Monotonic timestamps retain optimistic concurrency even for same-millisecond writes.
        if (
          request.status === "DISPATCHED" &&
          ((input.courier !== undefined && input.courier !== request.courier) ||
            (input.trackingReference !== undefined &&
              input.trackingReference !== request.trackingReference))
        )
          return null;
        const updatedAt = new Date(
          Math.max(Date.now(), request.updatedAt.getTime() + 1),
        );
        const [updated] = await tx
          .update(fulfillmentRequests)
          .set({
            status: input.status,
            handledByWallet: handler,
            updatedAt,
            ...(input.courier !== undefined ? { courier: input.courier } : {}),
            ...(input.trackingReference !== undefined
              ? { trackingReference: input.trackingReference }
              : {}),
          })
          .where(eq(fulfillmentRequests.id, request.id))
          .returning();
        return updated ?? null;
      });
    },
    operations(expected: {
      artwork: typeof artworks.$inferSelect;
      request: typeof fulfillmentRequests.$inferSelect | null;
    }) {
      return createOperationPreparationStore(db, async (tx, artwork) => {
        if (
          artwork.id !== expected.artwork.id ||
          artwork.updatedAt.toISOString() !== expected.artwork.updatedAt.toISOString()
        )
          return false;
        // Parent lock serializes UNKNOWN receipt writes with replacement preparations.
        const unresolved = await tx.execute(sql`select 1 from transaction_receipts r
          join blockchain_operations o on o.id = r.operation_id
          where o.artwork_id = ${artwork.id} and o.kind = 'UPDATE_CUSTODY'
          and o.cluster = ${cluster} and r.cluster = ${cluster} and r.status = 'UNKNOWN' limit 1`);
        if (unresolved.length) return false;
        if (!expected.request) return true;
        const [request] = await tx
          .select()
          .from(fulfillmentRequests)
          .where(eq(fulfillmentRequests.id, expected.request.id))
          .for("share");
        return (
          request !== undefined &&
          request.artworkId === artwork.id &&
          request.requesterWallet === expected.request.requesterWallet &&
          request.kind === expected.request.kind &&
          request.status === expected.request.status &&
          request.updatedAt.toISOString() === expected.request.updatedAt.toISOString()
        );
      });
    },
  };
}
export type CustodyOperationStore = ReturnType<typeof createCustodyOperationStore>;
