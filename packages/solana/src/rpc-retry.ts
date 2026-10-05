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
