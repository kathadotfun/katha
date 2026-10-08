import { findArtworkPda, findAssetPda } from "@katha/solana/registry";
import { findListingPda } from "@katha/solana/marketplace";
import type { WalletOperation } from "./wallet-operation.ts";
import {
  listingCreateRequestSchema,
  listingPriceSchema,
  artworkListingResponseSchema,
  artworkProvenanceResponseSchema,
  type ArtworkListingResponse,
  type ListingCreateRequest,
} from "@katha/shared";
import type { WalletSessionController } from "./wallet-session.ts";
import type { WalletConnection } from "./wallet-connection.ts";
import type { TransactionLifecycle } from "./transaction-lifecycle.ts";
import type { createPublicApi } from "./public-api.ts";
export function testTokenBaseUnits(value: string): string {
  if (!/^(0|[1-9][0-9]{0,19})(?:\.[0-9]{1,6})?$/.test(value))
    throw new Error(
      "Enter a positive test-token amount with at most six decimal places.",
    );
  const [whole, fraction = ""] = value.split(".");
  return listingPriceSchema.parse(
    (BigInt(whole!) * 1000000n + BigInt(fraction.padEnd(6, "0"))).toString(),
  );
}
export function listingExpiry(value: string, now = Date.now()): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Choose a valid expiry date and time.");
  const time = new Date(value).getTime();
  const date = new Date(value);
  const local = `${date.getFullYear().toString().padStart(4, "0")}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}T${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
  if (local !== value || !Number.isFinite(time) || time <= now)
    throw new Error("Expiry must be in the future.");
  return String(Math.floor(time / 1000));
}
export type OwnerListingSnapshot = Readonly<{
  page: ArtworkListingResponse | null;
  collection: string | null;
  busy: boolean;
  error: string | null;
  reloadRequired: boolean;
}>;
export const emptyOwnerListingSnapshot: OwnerListingSnapshot = {
  page: null,
  collection: null,
  busy: false,
  error: null,
  reloadRequired: false,
};
export function createOwnerListing(
  session: Pick<
    WalletSessionController,
    "getSnapshot" | "subscribe" | "prepareListing"
  >,
  connection: Pick<WalletConnection, "getSnapshot" | "subscribe" | "cluster">,
  transactions: Pick<TransactionLifecycle, "load" | "getSnapshot">,
  api: Pick<ReturnType<typeof createPublicApi>, "listing" | "provenance">,
  kathaId: string,
) {
  let state = emptyOwnerListingSnapshot,
    generation = 0,
    disposed = false;
  let abort: AbortController | null = null;
  const listeners = new Set<() => void>();
  const identity = () => {
    const auth = session.getSnapshot().session,
      wallet = connection.getSnapshot().connected;
    return auth &&
      wallet &&
      auth.walletAddress === wallet.address &&
      auth.cluster === connection.cluster
      ? `${auth.walletId}:${auth.expiresAt}:${wallet.address}:${wallet.walletId}`
      : null;
  };
  let current = identity();
  const publish = (patch: Partial<OwnerListingSnapshot>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const change = () => {
    const next = identity();
    if (next !== current) {
      current = next;
      generation++;
      abort?.abort();
      state = emptyOwnerListingSnapshot;
      publish({});
    }
  };
  const unsubSession = session.subscribe(change),
    unsubWallet = connection.subscribe(change);
  const canPrepare = () =>
    !!current &&
    !!state.page &&
    !state.busy &&
    !state.reloadRequired &&
    state.page.owner === session.getSnapshot().session?.walletAddress &&
    state.collection !== null &&
    (!state.page.listing ||
      ["CANCELLED", "EXPIRED", "PURCHASED"].includes(state.page.listing.status)) &&
    ["idle", "not-completed", "expired", "failed"].includes(
      transactions.getSnapshot().phase,
    ) &&
    (!transactions.getSnapshot().signature ||
      transactions.getSnapshot().phase === "failed");
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    canPrepare,
    async read() {
      if (disposed || !current || state.busy) return;
      const version = ++generation;
      abort?.abort();
      abort = new AbortController();
      const signal = abort.signal;
      publish({ busy: true, page: null, collection: null, error: null });
      try {
        const [page, history] = await Promise.all([
          api.listing(kathaId, { signal }),
          api.provenance(kathaId, { limit: "1" }, { signal }),
        ]);
        if (disposed || signal.aborted || version !== generation) return;
        artworkListingResponseSchema.parse(page);
        artworkProvenanceResponseSchema.parse(history);
        if (
          page.kathaId !== kathaId ||
          page.cluster !== connection.cluster ||
          history.kathaId !== kathaId ||
          history.chain.cluster.toLowerCase() !== page.cluster ||
          history.chain.coreAssetAddress !== page.asset ||
          !history.chain.collectionAddress
        )
          throw new Error("Artwork binding changed");
        publish({
          page,
          collection: history.chain.collectionAddress,
          reloadRequired: false,
          error:
            page.owner === session.getSnapshot().session?.walletAddress
              ? null
              : "The connected wallet is not the observed Core owner.",
        });
      } catch {
        if (!disposed && !signal.aborted && version === generation)
          publish({
            error: "Listing state could not be loaded. Check the API and refresh.",
          });
      } finally {
        if (!disposed && version === generation) publish({ busy: false });
      }
    },
    async prepare(priceText: string, expiryText: string) {
      if (disposed || !canPrepare()) return;
      let input: ListingCreateRequest;
      try {
        const wallet = connection.getSnapshot().connected!;
        input = listingCreateRequestSchema.parse({
          idempotencyKey: crypto.randomUUID(),
          expectedRevision: state.page!.currentRevision,
          price: testTokenBaseUnits(priceText),
          expiresAt: listingExpiry(expiryText),
          supportedTransactionVersions: [
            ...(wallet.supportsV0 ? [0] : []),
            ...(wallet.supportsV1 ? [1] : []),
          ],
        });
        if (BigInt(input.expiresAt) <= BigInt(state.page!.chainTime))
          throw new Error("Choose an expiry after the observed chain time.");
      } catch {
        publish({
          error:
            "Enter a positive amount with up to six decimals and a valid future expiry. A transaction-capable wallet is required.",
        });
        return;
      }
      const page = state.page!,
        collection = state.collection!,
        version = ++generation;
      abort?.abort();
      abort = new AbortController();
      const signal = abort.signal;
      publish({ busy: true, error: null });
      try {
        const prepared = await session.prepareListing(kathaId, input, signal);
        if (disposed || signal.aborted || version !== generation) return;
        await transactions.load(prepared, {
          kind: "CREATE_LISTING",
          kathaId,
          listing: {
            price: input.price,
            expiresAt: input.expiresAt,
            expectedRevision: input.expectedRevision,
            asset: page.asset,
            collection,
          },
        });
        if (!disposed && version === generation) publish({ reloadRequired: true });
      } catch {
        if (!disposed && !signal.aborted && version === generation)
          publish({
            reloadRequired: true,
            error:
              "Listing preparation did not complete. Refresh state before trying again; check any pending transaction first.",
          });
      } finally {
        if (!disposed && version === generation) publish({ busy: false });
      }
    },
    dispose() {
      disposed = true;
      generation++;
      abort?.abort();
      unsubSession();
      unsubWallet();
      listeners.clear();
      state = emptyOwnerListingSnapshot;
    },
  };
}
export type OwnerListing = ReturnType<typeof createOwnerListing>;

// A finalized receipt and a matching finalized listing observation are separate checks.
export async function listingObservationMatches(
  operation: Extract<WalletOperation, { kind: "CREATE_LISTING" }>,
  current: ArtworkListingResponse,
) {
  const [artwork] = await findArtworkPda({ kathaId: operation.kathaId });
  const [asset] = await findAssetPda({ artwork });
  const [listing] = await findListingPda({ asset });
  return (
    current.kathaId === operation.kathaId &&
    current.cluster === operation.cluster &&
    current.asset === asset &&
    current.owner === operation.feePayer &&
    current.currentRevision === operation.nextRevision &&
    current.listing?.address === listing &&
    current.listing.status === "ACTIVE" &&
    current.listing.active === true &&
    current.listing.seller === operation.feePayer &&
    current.listing.revision === operation.nextRevision &&
    current.listing.price === operation.price &&
    current.listing.expiresAt === operation.expiresAt
  );
}
