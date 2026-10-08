import {
  artworkProvenanceResponseSchema,
  canonicalDocumentBytes,
  metadataDocumentSchema,
  sha256Hex,
  walletAddressSchema,
  type ArtworkProvenanceResponse,
  type PublicArtworkDetail,
} from "@katha/shared";

export type MetadataIntegrity = {
  status: "MATCH" | "MISMATCH" | "INVALID" | "UNAVAILABLE" | "UNSUPPORTED";
  actualHash?: string;
};
export type ArtworkEvidence = {
  history: ArtworkProvenanceResponse | null;
  integrity: MetadataIntegrity;
};

export function historyOffset(value: string | string[] | undefined): number | null {
  if (value === undefined) return 0;
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,5})$/.test(value)) return null;
  const offset = Number(value);
  return offset <= 100000 && offset % 20 === 0 ? offset : null;
}

export function validateArtworkHistory(
  artwork: PublicArtworkDetail,
  value: unknown,
  offset: number,
): ArtworkProvenanceResponse {
  const history = artworkProvenanceResponseSchema.parse(value);
  if (
    history.kathaId !== artwork.kathaId ||
    history.attribution.artist.id !== artwork.artist.id ||
    history.attribution.creatorWallet !== artwork.creatorWallet ||
    history.chain.cluster !== artwork.chain.cluster ||
    history.chain.coreAssetAddress !== artwork.chain.coreAssetAddress ||
    (artwork.chain.registryRecordAddress !== null &&
      history.chain.registryRecordAddress !== artwork.chain.registryRecordAddress) ||
    (artwork.chain.collectionAddress !== null &&
      history.chain.collectionAddress !== artwork.chain.collectionAddress) ||
    history.pagination.offset !== offset ||
    history.pagination.limit !== 20 ||
    history.items.some((event) => {
      if (event.type === "MINT" || event.type === "TRANSFER")
        return (
          event.data.assetAddress !== artwork.chain.coreAssetAddress ||
          (event.type === "TRANSFER" &&
            event.data.sale !== null &&
            (event.data.sale.buyerWallet !== event.data.newOwner ||
              event.data.sale.listingAddress !== event.data.authorityWallet))
        );
      if (event.type === "REGISTRATION")
        return (
          event.data.artistId !== artwork.artist.id ||
          event.data.creatorWallet !== artwork.creatorWallet ||
          (history.chain.registryRecordAddress !== null &&
            event.data.registryRecordAddress !== history.chain.registryRecordAddress)
        );
      return false;
    })
  )
    throw new Error("Artwork history does not match the requested record");
  return history;
}

export function explorerLink(
  cluster: PublicArtworkDetail["chain"]["cluster"],
  kind: "address" | "tx",
  value: string,
): string | null {
  const valid =
    kind === "address"
      ? walletAddressSchema.safeParse(value).success
      : /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value);
  return cluster === "DEVNET" && valid
    ? `https://explorer.solana.com/${kind}/${value}?cluster=devnet`
    : null;
}

async function beforeDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort = () => {};
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

// Never proxy a URI supplied by metadata. Only the configured public storage
// origin and the exact committed filename may be fetched; redirects are rejected.
export async function checkMetadataIntegrity(
  artwork: PublicArtworkDetail,
  apiOrigin: string,
  request: typeof fetch = fetch,
  timeoutMs = 10000,
): Promise<MetadataIntegrity> {
  const expected = new URL(
    `/storage/public/${artwork.metadata.documentHash}.json`,
    apiOrigin,
  ).href;
  if (artwork.metadata.uri !== expected) return { status: "UNSUPPORTED" };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let actualHash: string | undefined;
  try {
    const signal = AbortSignal.timeout(timeoutMs);
    const response = await beforeDeadline(
      request(expected, {
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal,
      }),
      signal,
    );
    if (!response.ok || !response.body) return { status: "UNAVAILABLE" };
    if (
      response.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json"
    )
      return { status: "INVALID" };
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      // The deadline covers body consumption as well as response headers.
      const chunk = await beforeDeadline(reader.read(), signal);
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > 1024 * 1024) return { status: "INVALID" };
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let position = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, position);
      position += chunk.length;
    }
    actualHash = await sha256Hex(bytes);
    if (actualHash !== artwork.metadata.documentHash)
      return { status: "MISMATCH", actualHash };
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    const document = metadataDocumentSchema.parse(value);
    const canonical = canonicalDocumentBytes(value);
    if (
      canonical.length !== bytes.length ||
      !canonical.every((byte, index) => byte === bytes[index]) ||
      document.kathaId !== artwork.kathaId ||
      document.category !== artwork.category ||
      document.artist.artistId !== artwork.artist.id ||
      (document.artist.creatorWallet ?? null) !== artwork.creatorWallet
    )
      return { status: "INVALID", actualHash };
    return { status: "MATCH", actualHash };
  } catch {
    return actualHash ? { status: "INVALID", actualHash } : { status: "UNAVAILABLE" };
  } finally {
    await reader?.cancel().catch(() => undefined);
  }
}
