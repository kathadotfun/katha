import type { Server } from "node:http";
import type { Readiness } from "./readiness.js";

export const HTTP_DRAIN_TIMEOUT_MS = 5000;
export const DATABASE_CLOSE_TIMEOUT_MS = 6000;

/** Mark unavailable first, drain HTTP, then close the owned database exactly once. */
export function createShutdown(
  server: Pick<Server, "close" | "closeAllConnections">,
  readiness: Readiness,
  closeDatabase: () => Promise<void>,
) {
  let completion: Promise<boolean> | undefined;
  return function shutdown(): Promise<boolean> {
    if (completion) return completion;
    readiness.stop();
    completion = (async () => {
      const drained = await new Promise<boolean>((resolve) => {
        let forced = false;
        const timer = setTimeout(() => {
          forced = true;
          server.closeAllConnections();
          resolve(false);
        }, HTTP_DRAIN_TIMEOUT_MS);
        try {
          server.close((error) => {
            clearTimeout(timer);
            resolve(!error && !forced);
          });
        } catch {
          clearTimeout(timer);
          resolve(false);
        }
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const closed = await Promise.race([
          Promise.resolve()
            .then(closeDatabase)
            .then(
              () => true,
              () => false,
            ),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), DATABASE_CLOSE_TIMEOUT_MS);
          }),
        ]);
        return drained && closed;
      } finally {
        clearTimeout(timer);
      }
    })();
    return completion;
  };
}
