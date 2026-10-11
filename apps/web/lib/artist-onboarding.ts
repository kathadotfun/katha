import {
  artistCreateRequestSchema,
  type ArtistResponse,
  type WalletPermissions,
} from "@katha/shared";
import { WalletSessionApiError } from "./wallet-session-api.ts";
import type { WalletSessionController } from "./wallet-session.ts";

export type OnboardingSnapshot = Readonly<{
  status: "locked" | "checking" | "ready" | "denied" | "unavailable";
  permissions: WalletPermissions | null;
  busy: "create" | "read" | "verify" | null;
  artist: ArtistResponse | null;
  error: string | null;
}>;
export const lockedOnboardingSnapshot: OnboardingSnapshot = {
  status: "locked",
  permissions: null,
  busy: null,
  artist: null,
  error: null,
};
const messages = {
  UNAUTHENTICATED: "Your session changed or expired. Sign in again.",
  FORBIDDEN: "This wallet no longer has permission. Check access again.",
  CONFLICT:
    "The slug already exists or this artist was already verified. Review the existing profile before trying again.",
  NOT_FOUND: "Artist not found. Check the artist record ID.",
  INVALID_REQUEST: "The server rejected these fields. Check the profile details.",
  UNAVAILABLE:
    "The request could not be confirmed. For creation, keep the same slug when retrying; for verification, reload the profile first.",
};
// Authority changes discard all operator data and invalidate outstanding responses.
export function createArtistOnboarding(
  session: Pick<
    WalletSessionController,
    | "getSnapshot"
    | "subscribe"
    | "permissions"
    | "createArtist"
    | "readArtist"
    | "verifyArtist"
  >,
) {
  let state = lockedOnboardingSnapshot;
  let generation = 0;
  let disposed = false;
  let abort: AbortController | null = null;
  const listeners = new Set<() => void>();
  const identity = () => {
    const auth = session.getSnapshot();
    return auth.status === "signed-in" && auth.session
      ? `${auth.session.walletId}:${auth.session.walletAddress}:${auth.session.cluster}:${auth.session.expiresAt}`
      : null;
  };
  let current = identity();
  function publish(value: OnboardingSnapshot) {
    state = value;
    for (const listener of listeners) listener();
  }
  const unsubscribe = session.subscribe(() => {
    const next = identity();
    if (current !== next) {
      current = next;
      generation++;
      abort?.abort();
      publish(lockedOnboardingSnapshot);
    }
  });
  async function run(
    action: "check" | "create" | "read" | "verify",
    request: (signal: AbortSignal) => Promise<WalletPermissions | ArtistResponse>,
  ) {
    if (disposed || !current || state.busy || state.status === "checking") return;
    if (
      action !== "check" &&
      (state.status !== "ready" ||
        !(action === "create" ? state.permissions?.admin : state.permissions?.verifier))
    )
      return;
    const version = ++generation;
    abort = new AbortController();
    const signal = abort.signal;
    publish({
      ...state,
      ...(action === "check"
        ? { status: "checking" as const, permissions: null, artist: null }
        : { busy: action }),
      ...(action === "read" ? { artist: null } : {}),
      error: null,
    });
    try {
      const result = await request(signal);
      if (disposed || signal.aborted || version !== generation) return;
      if (action === "check") {
        const permissions = result as WalletPermissions;
        publish({
          ...lockedOnboardingSnapshot,
          permissions,
          status: permissions.admin || permissions.verifier ? "ready" : "denied",
        });
      } else publish({ ...state, busy: null, artist: result as ArtistResponse });
    } catch (error) {
      if (disposed || signal.aborted || version !== generation) return;
      const code = error instanceof WalletSessionApiError ? error.code : "UNAVAILABLE";
      const losesAccess = code === "FORBIDDEN" || code === "UNAUTHENTICATED";
      publish({
        ...state,
        busy: null,
        ...(action === "check" || losesAccess
          ? {
              status:
                code === "FORBIDDEN" ? ("denied" as const) : ("unavailable" as const),
              permissions: null,
              artist: null,
            }
          : {}),
        error: messages[code],
      });
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    check: () => run("check", (signal) => session.permissions(signal)),
    create(input: unknown) {
      const parsed = artistCreateRequestSchema.safeParse(input);
      if (!parsed.success) return Promise.resolve();
      return run("create", (signal) => session.createArtist(parsed.data, signal));
    },
    read: (id: string) => run("read", (signal) => session.readArtist(id, signal)),
    verify(confirmed: boolean) {
      const artist = state.artist;
      if (!confirmed || !artist || artist.verificationStatus !== "UNVERIFIED")
        return Promise.resolve();
      return run("verify", (signal) =>
        session.verifyArtist(artist.id, { confirmed: true }, signal),
      );
    },
    dispose() {
      disposed = true;
      generation++;
      abort?.abort();
      unsubscribe();
      listeners.clear();
      state = lockedOnboardingSnapshot;
    },
  };
}
export type ArtistOnboarding = ReturnType<typeof createArtistOnboarding>;
