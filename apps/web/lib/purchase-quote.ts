import {
  purchaseQuoteResponseSchema,
  purchaseQuoteTermsSchema,
  publicArtworkDetailSchema,
  tokenAmountSchema,
  canonicalDocumentBytes,
  sha256Hex,
  type PurchaseQuoteResponse,
  type PublicArtworkDetail,
} from "@katha/shared";
import { calculateMarketplaceDistribution } from "@katha/solana";
import { findArtworkPda, findAssetPda } from "@katha/solana/registry";
import { findListingPda } from "@katha/solana/marketplace";
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
}>;
export const emptyPurchaseQuote: PurchaseQuoteSnapshot = {
  status: "locked",
  quote: null,
  artwork: null,
};
export function createPurchaseQuote(
  session: Pick<
    WalletSessionController,
    "getSnapshot" | "subscribe" | "readPurchaseQuote"
  >,
  connection: Pick<WalletConnection, "getSnapshot" | "subscribe" | "cluster">,
  api: Pick<ReturnType<typeof createPublicApi>, "artwork">,
  kathaId: string,
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
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async refresh() {
      if (disposed || !current || state.status === "loading") return;
      const version = ++generation;
      abort?.abort();
      abort = new AbortController();
      const signal = abort.signal;
      const wallet = connection.getSnapshot().connected!,
        auth = session.getSnapshot().session!;
      publish({ status: "loading", quote: null, artwork: null });
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
        publish({ status: "ready", ...checked });
      } catch {
        if (!disposed && !signal.aborted && version === generation)
          publish({ status: "unavailable", quote: null, artwork: null });
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
