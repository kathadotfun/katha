import {
  purchaseQuoteResponseSchema,
  purchaseQuoteTermsSchema,
  publicArtworkDetailSchema,
  tokenAmountSchema,
  canonicalDocumentBytes,
  sha256Hex,
  purchasePrepareRequestSchema,
  type PurchaseQuoteResponse,
  type PublicArtworkDetail,
} from "@katha/shared";
import { calculateMarketplaceDistribution } from "@katha/solana";
import { findArtworkPda, findAssetPda } from "@katha/solana/registry";
import { findListingPda } from "@katha/solana/marketplace";
import type { TransactionLifecycle } from "./transaction-lifecycle.ts";
import type { WalletSessionController } from "./wallet-session.ts";
import type { WalletConnection } from "./wallet-connection.ts";
import type { createPublicApi } from "./public-api.ts";

export function testTokenAmount(units: string) {
  const value = BigInt(tokenAmountSchema.parse(units));
  return `${value / 1000000n}.${(value % 1000000n).toString().padStart(6, "0")}`;
}
export async function validatePurchaseQuote(
  input: unknown,
  artworkInput: unknown,
  context: { kathaId: string; wallet: string; cluster: "localnet" | "devnet" },
) {
  const quote = purchaseQuoteResponseSchema.parse(input),
    artwork = publicArtworkDetailSchema.parse(artworkInput);
  const [record] = await findArtworkPda({ kathaId: context.kathaId });
  const [asset] = await findAssetPda({ artwork: record });
  const [listing] = await findListingPda({ asset });
  const terms = purchaseQuoteTermsSchema.strip().parse(quote);
  const expected = calculateMarketplaceDistribution(
    quote.price,
    quote.saleKind,
    quote.fees,
    quote,
  );
  if (
    quote.kathaId !== context.kathaId ||
    artwork.kathaId !== context.kathaId ||
    quote.buyer !== context.wallet ||
    quote.cluster !== context.cluster ||
    artwork.chain.cluster.toLowerCase() !== quote.cluster ||
    quote.asset !== asset ||
    artwork.chain.coreAssetAddress !== asset ||
    quote.listing !== listing ||
    [quote.seller, quote.artistPayout, quote.treasury].includes(quote.buyer) ||
    BigInt(quote.expiresAt) <= BigInt(quote.chainTime) ||
    JSON.stringify(expected) !== JSON.stringify(quote.distribution) ||
    (await sha256Hex(canonicalDocumentBytes(terms))) !== quote.quoteHash
  )
    throw new Error("Quote binding or distribution mismatch");
  return { quote, artwork };
}
export type PurchaseQuoteSnapshot = Readonly<{
  status: "locked" | "loading" | "ready" | "unavailable";
  quote: PurchaseQuoteResponse | null;
  artwork: PublicArtworkDetail | null;
  preparing: boolean;
  preparationError: string | null;
}>;
export const emptyPurchaseQuote: PurchaseQuoteSnapshot = {
  status: "locked",
  quote: null,
  artwork: null,
  preparing: false,
  preparationError: null,
};
export function createPurchaseQuote(
  session: Pick<
    WalletSessionController,
    "getSnapshot" | "subscribe" | "readPurchaseQuote" | "preparePurchase"
  >,
  connection: Pick<WalletConnection, "getSnapshot" | "subscribe" | "cluster">,
  api: Pick<ReturnType<typeof createPublicApi>, "artwork">,
  kathaId: string,
  transactions?: Pick<TransactionLifecycle, "load" | "getSnapshot">,
) {
  let state = emptyPurchaseQuote,
    generation = 0,
    disposed = false;
  let abort: AbortController | null = null;
  const listeners = new Set<() => void>();
  const identity = () => {
    const auth = session.getSnapshot(),
      wallet = connection.getSnapshot().connected;
    return auth.status === "signed-in" &&
      auth.session &&
      wallet &&
      auth.session.walletAddress === wallet.address &&
      auth.session.cluster === connection.cluster
      ? `${JSON.stringify(auth.session)}:${wallet.walletId}`
      : null;
  };
  let current = identity();
  const publish = (next: PurchaseQuoteSnapshot) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const change = () => {
    const next = identity();
    if (next !== current) {
      current = next;
      generation++;
      abort?.abort();
      publish(emptyPurchaseQuote);
    }
  };
  const unsubSession = session.subscribe(change),
    unsubWallet = connection.subscribe(change);
  const canPrepare = () => {
    const tx = transactions?.getSnapshot();
    return (
      !!current &&
      state.status === "ready" &&
      !!state.quote &&
      !!state.artwork?.chain.collectionAddress &&
      !state.preparing &&
      !!tx &&
      ["idle", "not-completed", "expired", "failed"].includes(tx.phase) &&
      (!tx.signature || tx.phase === "failed")
    );
  };
  return {
    canPrepare,
    async prepare() {
      if (disposed || !canPrepare()) return;
      const quote = state.quote!,
        collection = state.artwork!.chain.collectionAddress!,
        version = ++generation;
      abort?.abort();
      abort = new AbortController();
      const signal = abort.signal;
      publish({ ...state, preparing: true, preparationError: null });
      try {
        const wallet = connection.getSnapshot().connected!;
        const input = purchasePrepareRequestSchema.parse({
          idempotencyKey: crypto.randomUUID(),
          quoteHash: quote.quoteHash,
          supportedTransactionVersions: [
            ...(wallet.supportsV0 ? [0] : []),
            ...(wallet.supportsV1 ? [1] : []),
          ],
        });
        const prepared = await session.preparePurchase(kathaId, input, signal);
        if (disposed || signal.aborted || version !== generation) return;
        await transactions!.load(prepared, {
          kind: "PURCHASE_ARTWORK",
          kathaId,
          purchase: { quote, collection },
        });
        if (disposed || signal.aborted || version !== generation) return;
        // Clear the actionable preview: a new review must obtain current terms.
        publish({ ...emptyPurchaseQuote, status: "locked" });
      } catch {
        if (!disposed && !signal.aborted && version === generation)
          publish({
            ...emptyPurchaseQuote,
            status: "unavailable",
            preparationError:
              "Purchase preparation did not complete. The quote may be stale; refresh current terms and check any pending signature before trying again.",
          });
      }
    },
    getSnapshot: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async refresh() {
      if (disposed || !current || state.status === "loading" || state.preparing) return;
      const version = ++generation;
      abort?.abort();
      abort = new AbortController();
      const signal = abort.signal;
      const wallet = connection.getSnapshot().connected!,
        auth = session.getSnapshot().session!;
      publish({ ...emptyPurchaseQuote, status: "loading" });
      try {
        const supportedTransactionVersions = [
          ...(wallet.supportsV0 ? [0 as const] : []),
          ...(wallet.supportsV1 ? [1 as const] : []),
        ];
        const [quote, artwork] = await Promise.all([
          session.readPurchaseQuote(kathaId, { supportedTransactionVersions }, signal),
          api.artwork(kathaId, { signal }),
        ]);
        const checked = await validatePurchaseQuote(quote, artwork, {
          kathaId,
          wallet: auth.walletAddress,
          cluster: auth.cluster,
        });
        if (disposed || signal.aborted || version !== generation) return;
        publish({ ...emptyPurchaseQuote, status: "ready", ...checked });
      } catch {
        if (!disposed && !signal.aborted && version === generation)
          publish({ ...emptyPurchaseQuote, status: "unavailable" });
      }
    },
    dispose() {
      disposed = true;
      generation++;
      abort?.abort();
      unsubSession();
      unsubWallet();
      listeners.clear();
      state = emptyPurchaseQuote;
    },
  };
}
export type PurchaseQuoteController = ReturnType<typeof createPurchaseQuote>;
