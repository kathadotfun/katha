export const READINESS_TIMEOUT_MS = 2000;

/** Share the actual probe until it settles, even when callers time out. */
export function createReadiness(check: () => Promise<void>) {
  let stopping = false;
  let probe: Promise<boolean> | undefined;
  return {
    stop() {
      stopping = true;
    },
    isStopping() {
      return stopping;
    },
    async check(): Promise<boolean> {
      if (stopping) return false;
      if (!probe) {
        probe = Promise.resolve()
          .then(check)
          .then(
            () => true,
            () => false,
          );
        void probe.finally(() => {
          probe = undefined;
        });
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const healthy = await Promise.race([
          probe,
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), READINESS_TIMEOUT_MS);
          }),
        ]);
        return healthy && !stopping;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
export type Readiness = ReturnType<typeof createReadiness>;
