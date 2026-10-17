import {
  isSolanaError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_MIN_CONTEXT_SLOT_NOT_REACHED,
  SOLANA_ERROR__JSON_RPC__INTERNAL_ERROR,
} from "@solana/kit";
/** Only transient transport/provider failures, never malformed chain evidence. */
export function isRetryableRpcFailure(error: unknown): boolean {
  if (isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR))
    return error.context.statusCode === 429 || error.context.statusCode >= 500;
  if (
    isSolanaError(error, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY) ||
    isSolanaError(
      error,
      SOLANA_ERROR__JSON_RPC__SERVER_ERROR_MIN_CONTEXT_SLOT_NOT_REACHED,
    ) ||
    isSolanaError(error, SOLANA_ERROR__JSON_RPC__INTERNAL_ERROR)
  )
    return true;
  if (error instanceof Error && error.name === "TimeoutError") return true;
  if (
    error instanceof TypeError &&
    error.cause &&
    typeof error.cause === "object" &&
    "code" in error.cause
  )
    return [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_SOCKET",
    ].includes(String(error.cause.code));
  return false;
}

function waitForRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/** Retry only an idempotent RPC read, never signing or transaction submission. */
export async function retryRpcRead<T>(
  read: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await read();
    } catch (error) {
      signal?.throwIfAborted();
      if (attempt === 4 || !isRetryableRpcFailure(error)) throw error;
      let delay = 1000 * 2 ** attempt;
      if (isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
        const header = error.context.headers.get("retry-after");
        if (header !== null && header.trim() !== "") {
          const retryAfterMs = /^\d+(?:\.\d+)?$/.test(header.trim())
            ? Number(header) * 1000
            : Date.parse(header) - Date.now();
          // A longer provider cooldown exceeds this bounded interactive read.
          // Surface the failure rather than retrying earlier than requested.
          if (retryAfterMs > 30_000) throw error;
          if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0)
            delay = Math.max(delay, retryAfterMs);
        }
      }
      await waitForRetry(delay, signal);
    }
  }
}
