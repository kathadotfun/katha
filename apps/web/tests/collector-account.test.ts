import assert from "node:assert/strict";
import { test } from "node:test";
import { createCollectorAccount } from "../lib/collector-account.ts";
import {
  createWalletSessionApi,
  WalletSessionApiError,
} from "../lib/wallet-session-api.ts";
import type { WalletSessionSnapshot } from "../lib/wallet-session.ts";
const session = {
  walletId: "aaaaaaaa-1111-4111-8111-111111111111",
  walletAddress: "11111111111111111111111111111111",
  cluster: "localnet" as const,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
const response = () => ({
  session,
  indexedArtworkCount: 0,
  evaluatedAt: new Date().toISOString(),
});
function fixture() {
  let state: WalletSessionSnapshot = { status: "signed-in", session, error: null };
  const listeners = new Set<() => void>();
  let calls = 0;
  const methods = {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    readAccount: async (_signal: AbortSignal) => {
      assert.equal(_signal.aborted, false);
      calls++;
      return response();
    },
  };
  return {
    methods,
    calls: () => calls,
    listeners,
    emit(next: WalletSessionSnapshot) {
      state = next;
      for (const listener of listeners) listener();
    },
  };
}
test("account transport uses a private no-store GET with strict response validation", async () => {
  const api = createWalletSessionApi("http://localhost:3001", async (url, init) => {
    assert.equal(String(url), "http://localhost:3001/account");
    assert.equal(init?.method, "GET");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic");
    assert.equal(init?.body, undefined);
    return Response.json(response());
  });
  assert.equal(
    (await api.readAccount("synthetic", new AbortController().signal))
      .indexedArtworkCount,
    0,
  );
  const invalid = createWalletSessionApi("http://localhost:3001", async () =>
    Response.json({ ...response(), token: "PRIVATE" }),
  );
  await assert.rejects(invalid.readAccount("synthetic", new AbortController().signal));
});
test("account handles zero holdings, loading, failure and retry without stale counts", async () => {
  const f = fixture(),
    account = createCollectorAccount(f.methods);
  await account.refresh();
  assert.equal(account.getSnapshot().account?.indexedArtworkCount, 0);
  f.methods.readAccount = async () => {
    throw new Error("PRIVATE NETWORK ERROR");
  };
  await account.refresh();
  assert.equal(account.getSnapshot().status, "unavailable");
  assert.equal(account.getSnapshot().account, null);
  f.methods.readAccount = async () => ({ ...response(), indexedArtworkCount: 2 });
  await account.refresh();
  assert.equal(account.getSnapshot().account?.indexedArtworkCount, 2);
  account.dispose();
  assert.equal(f.listeners.size, 0);
});
for (const change of ["sign out", "wallet change", "dispose"])
  test(`account discards delayed results after ${change}`, async () => {
    const f = fixture();
    let resolve!: (value: ReturnType<typeof response>) => void;
    let signal!: AbortSignal;
    f.methods.readAccount = (value) => {
      signal = value;
      return new Promise((done) => {
        resolve = done;
      });
    };
    const account = createCollectorAccount(f.methods);
    const pending = account.refresh();
    assert.equal(account.getSnapshot().status, "loading");
    if (change === "dispose") account.dispose();
    else
      f.emit(
        change === "sign out"
          ? { status: "signed-out", session: null, error: null }
          : {
              status: "signed-in",
              session: {
                ...session,
                walletAddress: "11111111111111111111111111111112",
              },
              error: null,
            },
      );
    assert.equal(signal.aborted, true);
    resolve(response());
    await pending;
    assert.equal(account.getSnapshot().status, "locked");
    assert.equal(account.getSnapshot().account, null);
    account.dispose();
  });
test("locked account never reads and mismatched identity cannot be rendered", async () => {
  const f = fixture(),
    account = createCollectorAccount(f.methods);
  f.emit({ status: "signed-out", session: null, error: null });
  await account.refresh();
  assert.equal(f.calls(), 0);
  f.emit({ status: "signed-in", session, error: null });
  f.methods.readAccount = async () => ({
    ...response(),
    session: { ...session, walletId: "bbbbbbbb-1111-4111-8111-111111111111" },
  });
  await account.refresh();
  assert.equal(account.getSnapshot().status, "unavailable");
  assert.equal(account.getSnapshot().account, null);
  account.dispose();
});
test("account transport maps a revoked session to authentication failure", async () => {
  const api = createWalletSessionApi(
    "http://localhost:3001",
    async () => new Response(null, { status: 401 }),
  );
  await assert.rejects(
    api.readAccount("synthetic", new AbortController().signal),
    (e: unknown) => e instanceof WalletSessionApiError && e.code === "UNAUTHENTICATED",
  );
});
