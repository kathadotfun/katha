import {
  artistSlugSchema,
  artworkDiscoveryQuerySchema,
  artworkDiscoveryResponseSchema,
  artworkProvenanceQuerySchema,
  artworkProvenanceResponseSchema,
  kathaIdSchema,
  paginatedResponseSchema,
  paginationQuerySchema,
  publicArtistDetailSchema,
  publicArtistSummarySchema,
  publicArtworkDetailSchema,
} from "@katha/shared";

export type PublicApiErrorKind =
  "NOT_FOUND" | "UNAVAILABLE" | "INVALID_RESPONSE" | "TIMEOUT" | "CANCELLED";

export class PublicApiError extends Error {
  readonly kind: PublicApiErrorKind;

  constructor(kind: PublicApiErrorKind) {
    super(`Public API request failed: ${kind}`);
    this.name = "PublicApiError";
    this.kind = kind;
  }
}

export function publicApiOrigin(value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Public API configuration must be an HTTP(S) origin.");
  }
  return url.origin;
}

type Query = Readonly<Record<string, string>>;
type RequestOptions = { signal?: AbortSignal };

/** Only public reads belong here. Wallet sessions and admin writes have separate boundaries. */
export function createPublicApi(
  origin: string,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
) {
  const base = publicApiOrigin(origin);
  const send = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error("Public API timeout must be between 1 and 60000 ms.");
  }

  async function read<T>(
    path: string,
    schema: { parse(value: unknown): T },
    query: Query,
    request: RequestOptions,
  ): Promise<T> {
    const url = new URL(path, base);
    url.search = new URLSearchParams(query).toString();
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = request.signal
      ? AbortSignal.any([request.signal, deadline])
      : deadline;
    try {
      signal.throwIfAborted();
      const response = await send(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal,
      });
      if (!response.ok) {
        throw new PublicApiError(response.status === 404 ? "NOT_FOUND" : "UNAVAILABLE");
      }
      const contentType = response.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== "application/json") {
        throw new PublicApiError("INVALID_RESPONSE");
      }
      try {
        const body: unknown = await response.json();
        return schema.parse(body);
      } catch {
        signal.throwIfAborted();
        throw new PublicApiError("INVALID_RESPONSE");
      }
    } catch (error) {
      // Caller cancellation takes precedence when both signals have expired.
      if (request.signal?.aborted) throw new PublicApiError("CANCELLED");
      if (deadline.aborted) throw new PublicApiError("TIMEOUT");
      if (error instanceof PublicApiError) throw error;
      throw new PublicApiError("UNAVAILABLE");
    }
  }

  return {
    artworks(query: Query = {}, request: RequestOptions = {}) {
      const parsed = artworkDiscoveryQuerySchema.parse(query);
      return read(
        "/artworks",
        artworkDiscoveryResponseSchema,
        {
          limit: String(parsed.limit),
          offset: String(parsed.offset),
          ...(parsed.category ? { category: parsed.category } : {}),
        },
        request,
      );
    },
    artwork(id: string, request: RequestOptions = {}) {
      return read(
        `/artworks/${encodeURIComponent(kathaIdSchema.parse(id))}`,
        publicArtworkDetailSchema,
        {},
        request,
      );
    },
    artists(query: Query = {}, request: RequestOptions = {}) {
      const parsed = paginationQuerySchema.parse(query);
      return read(
        "/artists",
        paginatedResponseSchema(publicArtistSummarySchema),
        {
          limit: String(parsed.limit),
          offset: String(parsed.offset),
        },
        request,
      );
    },
    artist(slug: string, request: RequestOptions = {}) {
      return read(
        `/artists/${encodeURIComponent(artistSlugSchema.parse(slug))}`,
        publicArtistDetailSchema,
        {},
        request,
      );
    },
    provenance(id: string, query: Query = {}, request: RequestOptions = {}) {
      const parsed = artworkProvenanceQuerySchema.parse(query);
      return read(
        `/artworks/${encodeURIComponent(kathaIdSchema.parse(id))}/provenance`,
        artworkProvenanceResponseSchema,
        {
          limit: String(parsed.limit),
          offset: String(parsed.offset),
          ...(parsed.type ? { type: parsed.type } : {}),
        },
        request,
      );
    },
  };
}
