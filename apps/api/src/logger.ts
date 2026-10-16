import { apiErrorCodeSchema } from "@katha/shared";
import type { ApiErrorCode } from "./errors.js";

type LogSink = (line: string, level: "info" | "error") => void;
const settingNames = new Set([
  "NODE_ENV",
  "API_HOST",
  "API_PORT",
  "DATABASE_URL",
  "KATHA_CLUSTER",
  "KATHA_PUBLIC_APP_ORIGIN",
  "KATHA_PUBLIC_API_ORIGIN",
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const methods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

/** Fixed events and field selection prevent accidental logging of private objects. */
export function createLogger(
  sink: LogSink = (line, level) => {
    if (level === "error") console.error(line);
    else console.info(line);
  },
) {
  function write(
    event: string,
    level: "info" | "error",
    fields: Record<string, unknown>,
  ) {
    // Logging failures must not change HTTP or settlement outcomes.
    try {
      sink(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level,
          event,
          ...fields,
        }),
        level,
      );
    } catch {
      /* The transport owns recovery; do not fall back to printing private data. */
    }
  }
  return {
    requestCompleted(input: {
      requestId: string;
      method: string;
      status: number;
      durationMs: number;
      code?: ApiErrorCode;
    }) {
      write("request_completed", input.status >= 500 ? "error" : "info", {
        requestId: uuid.test(input.requestId) ? input.requestId : undefined,
        method: methods.has(input.method) ? input.method : "OTHER",
        status:
          Number.isInteger(input.status) && input.status >= 100 && input.status <= 599
            ? input.status
            : 500,
        durationMs: Number.isFinite(input.durationMs)
          ? Math.max(0, Math.round(input.durationMs))
          : 0,
        code: apiErrorCodeSchema.safeParse(input.code).success ? input.code : undefined,
      });
    },
    transactionObserved(input: {
      requestId: string;
      cluster: "localnet" | "devnet";
      signature: string;
    }) {
      // A bounded public identifier, not a wallet login signature or confirmation proof.
      if (
        !uuid.test(input.requestId) ||
        !["localnet", "devnet"].includes(input.cluster) ||
        !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(input.signature)
      )
        return;
      write("transaction_observed", "info", {
        requestId: input.requestId,
        cluster: input.cluster,
        signature: input.signature,
      });
    },
    configurationInvalid(fields: readonly string[]) {
      write("configuration_invalid", "error", {
        message: "Invalid API configuration. Check the server environment.",
        fields: [...new Set(fields.filter((field) => settingNames.has(field)))].sort(),
      });
    },
    activityPageObserved(input: {
      cluster: "localnet" | "devnet";
      transactions: number;
      activities: number;
    }) {
      if (
        !["localnet", "devnet"].includes(input.cluster) ||
        !Number.isInteger(input.transactions) ||
        input.transactions < 0 ||
        input.transactions > 100 ||
        !Number.isSafeInteger(input.activities) ||
        input.activities < 0
      )
        return;
      write("activity_page_observed", "info", {
        cluster: input.cluster,
        transactions: input.transactions,
        activities: input.activities,
      });
    },
    // Only a bounded class name, numeric RPC code and gap reason; never messages,
    // URLs or context that could carry endpoint credentials.
    activityPollingFailed(error?: unknown) {
      const record =
        error !== null && typeof error === "object"
          ? (error as Record<string, unknown>)
          : {};
      const name = typeof record.name === "string" ? record.name : undefined;
      const context = record.context;
      const code =
        context !== null &&
        typeof context === "object" &&
        typeof (context as Record<string, unknown>).__code === "number"
          ? (context as Record<string, number>).__code
          : undefined;
      const reason = typeof record.reason === "string" ? record.reason : undefined;
      write("activity_polling_failed", "error", {
        errorName: name && /^[A-Za-z]{1,40}$/.test(name) ? name : undefined,
        rpcErrorCode: Number.isSafeInteger(code) ? code : undefined,
        gapReason: reason && /^[A-Z_]{1,40}$/.test(reason) ? reason : undefined,
      });
    },
    serverStarted(port: number) {
      write("server_started", "info", {
        port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined,
      });
    },
    serverStopping(signal: NodeJS.Signals) {
      write("server_stopping", "info", {
        signal: signal === "SIGINT" || signal === "SIGTERM" ? signal : undefined,
      });
    },
    serverFailed() {
      write("server_failed", "error", {});
    },
  };
}
export type ApiLogger = ReturnType<typeof createLogger>;
