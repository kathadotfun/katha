import assert from "node:assert/strict";
import { test } from "node:test";
import type { UnsignedOperationResponse } from "@katha/shared";
import { walletSignInMessage, validateWalletSignInChallenge } from "@katha/shared";
import type {
  WalletConnectionSnapshot,
  WalletConnection,
} from "../lib/wallet-connection.ts";
import { createWalletSession } from "../lib/wallet-session.ts";
import {
  createWalletSessionApi,
  WalletSessionApiError,
} from "../lib/wallet-session-api.ts";

const origin = "http://localhost:3000";
const first = "11111111111111111111111111111111";
const second = "11111111111111111111111111111112";
const challengeId = "aaaaaaaa-1111-4111-8111-111111111111";
const signature = btoa(String.fromCharCode(...new Uint8Array(64)));
const token = "a".repeat(64);
function challenge() {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  return {
    challengeId,
    expiresAt,
    message: walletSignInMessage({
      origin,
      walletAddress: first,
      cluster: "localnet",
      nonce: "b".repeat(64),
      issuedAt: new Date().toISOString(),
      expiresAt,
      challengeId,
    }),
  };
}
function fixture() {
  let state: WalletConnectionSnapshot = {
    status: "connected",
    wallets: [],
    connected: {
      walletId: "wallet-1",
      walletName: "Test",
      address: first,
      accounts: [first, second],
      supportsV0: true,
      supportsV1: false,
      supportsMessageSigning: true,
    },
  };
  const listeners = new Set<() => void>();
  const revoked: string[] = [];
  let signCalls = 0;
  const connection: WalletConnection = {
    cluster: "localnet",
    signPreparedTransaction: async () => {
      throw new Error("No transactions in session fixture");
    },
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect: async () => {},
    disconnect: async () => {},
    selectAccount: () => {},
    dispose: () => {},
    signLoginChallenge: async (input, appOrigin) => {
      validateWalletSignInChallenge(input, {
        origin: appOrigin,
        walletAddress: first,
        cluster: "localnet",
      });
      signCalls++;
      return signature;
    },
  };
  const response = () => ({
    token,
    session: {
      walletId: challengeId,
      walletAddress: first,
      cluster: "localnet" as const,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  });
  const api = {
    receipt: async () => {
      throw new Error("No receipts in login fixture");
    },
    challenge: async () => challenge(),
    verify: async () => response(),
    logout: async (value: string) => {
      revoked.push(value);
    },
  };
  const emit = (patch: Partial<WalletConnectionSnapshot>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  return {
    connection,
    api,
    response,
    emit,
    revoked,
    signCalls: () => signCalls,
    listeners,
  };
}
test("sign-in retains only public session state; account changes and sign-out immediately revoke", async () => {
  const f = fixture();
  const auth = createWalletSession(f.connection, f.api, origin);
  await auth.signIn();
  assert.equal(auth.getSnapshot().status, "signed-in");
  assert.equal(f.signCalls(), 1);
  assert.ok(!JSON.stringify(auth.getSnapshot()).includes(token));
  f.emit({ connected: { ...f.connection.getSnapshot().connected!, address: second } });
  assert.equal(auth.getSnapshot().session, null);
  assert.deepEqual(f.revoked, [token]);
  f.emit({ connected: { ...f.connection.getSnapshot().connected!, address: first } });
  await auth.signIn();
  auth.signOut();
  assert.equal(auth.getSnapshot().status, "signed-out");
  assert.deepEqual(f.revoked, [token, token]);
  auth.dispose();
  assert.equal(f.listeners.size, 0);
});
test("same-address wallet replacement, disconnect and disposal clear sessions", async () => {
  for (const kind of ["wallet", "disconnect", "dispose"]) {
    const f = fixture();
    const auth = createWalletSession(f.connection, f.api, origin);
    await auth.signIn();
    if (kind === "wallet")
      f.emit({
        connected: { ...f.connection.getSnapshot().connected!, walletId: "wallet-2" },
      });
    else if (kind === "disconnect") f.emit({ connected: null, status: "disconnected" });
    else auth.dispose();
    assert.equal(auth.getSnapshot().session, null);
    assert.deepEqual(f.revoked, [token]);
    auth.dispose();
  }
});
test("late verification cannot restore a cancelled or changed session and its token is revoked", async () => {
  for (const kind of ["cancel", "switch", "dispose"]) {
    const f = fixture();
    let resolve!: (value: ReturnType<typeof f.response>) => void;
    const pending = new Promise<ReturnType<typeof f.response>>((done) => {
      resolve = done;
    });
    f.api.verify = () => pending;
    const auth = createWalletSession(f.connection, f.api, origin);
    const login = auth.signIn();
    await new Promise((done) => setImmediate(done));
    assert.equal(auth.getSnapshot().status, "signing-in");
    if (kind === "switch") f.emit({ connected: null, status: "disconnected" });
    else if (kind === "dispose") auth.dispose();
    else auth.signOut();
    resolve(f.response());
    await login;
    assert.equal(auth.getSnapshot().status, "signed-out");
    assert.deepEqual(f.revoked, [token]);
    auth.dispose();
  }
});
test("mismatched, expired or malformed sessions fail closed; rejected signing remains retryable", async () => {
  for (const patch of [
    { walletAddress: second },
    { cluster: "devnet" as const },
    { expiresAt: new Date(0).toISOString() },
  ]) {
    const f = fixture();
    f.api.verify = async () =>
      ({
        ...f.response(),
        session: { ...f.response().session, ...patch },
      }) as ReturnType<typeof f.response>;
    const auth = createWalletSession(f.connection, f.api, origin);
    await auth.signIn();
    assert.equal(auth.getSnapshot().session, null);
    assert.deepEqual(f.revoked, [token]);
    auth.dispose();
  }
  const f = fixture();
  f.connection.signLoginChallenge = async () => {
    throw new Error("PRIVATE_SIGNATURE_ERROR");
  };
  const auth = createWalletSession(f.connection, f.api, origin);
  await auth.signIn();
  assert.equal(auth.getSnapshot().status, "signed-out");
  assert.ok(!auth.getSnapshot().error?.includes("PRIVATE"));
  auth.dispose();
});
test("expiry clears local authority; failed logout reports unconfirmed revocation without retaining token", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  f.api.verify = async () => ({
    ...f.response(),
    session: {
      ...f.response().session,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  });
  const auth = createWalletSession(f.connection, f.api, origin);
  await auth.signIn();
  t.mock.timers.tick(60_001);
  assert.equal(auth.getSnapshot().session, null);
  auth.dispose();
  const g = fixture();
  g.api.logout = async () => {
    throw new Error("PRIVATE_NETWORK_ERROR");
  };
  const other = createWalletSession(g.connection, g.api, origin);
  await other.signIn();
  other.signOut();
  await new Promise((done) => setImmediate(done));
  assert.equal(other.getSnapshot().session, null);
  assert.match(other.getSnapshot().error!, /revocation could not be confirmed/);
  other.dispose();
});
test("session HTTP uses bounded, noncached, cookieless posts and validates shared responses", async () => {
  const calls: Request[] = [];
  const api = createWalletSessionApi("http://localhost:3001", async (url, init) => {
    const request = new Request(url, init);
    calls.push(request);
    if (request.url.endsWith("logout")) return new Response(null, { status: 401 });
    return Response.json(challenge(), { status: 201 });
  });
  await api.challenge(
    { walletAddress: first, cluster: "localnet" },
    new AbortController().signal,
  );
  await api.logout(token);
  assert.equal(calls[0]!.credentials, "omit");
  assert.equal(calls[0]!.cache, "no-store");
  assert.equal(calls[0]!.redirect, "error");
  assert.equal(calls[1]!.headers.get("Authorization"), `Bearer ${token}`);
  assert.ok(!calls[1]!.url.includes(token));
  const bad = createWalletSessionApi("http://localhost:3001", async () =>
    Response.json({ private: "PRIVATE" }),
  );
  await assert.rejects(
    bad.challenge(
      { walletAddress: first, cluster: "localnet" },
      new AbortController().signal,
    ),
  );
});

test("a rejected receipt session immediately clears authenticated state", async () => {
  const f = fixture();
  f.api.receipt = async () => {
    throw new WalletSessionApiError("UNAUTHENTICATED");
  };
  const auth = createWalletSession(f.connection, f.api, origin);
  await auth.signIn();
  await assert.rejects(
    auth.reconcile(
      { feePayer: first, cluster: "localnet" } as UnsignedOperationResponse,
      "synthetic",
      new AbortController().signal,
    ),
  );
  assert.equal(auth.getSnapshot().session, null);
  auth.dispose();
});
