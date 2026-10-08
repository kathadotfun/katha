import assert from "node:assert/strict";
import { test } from "node:test";
import { createResaleWorkflow } from "../lib/resale-inspection.ts";
import { createWalletSessionApi } from "../lib/wallet-session-api.ts";
import type { WalletSessionSnapshot } from "../lib/wallet-session.ts";
import { resaleFixture } from "./fixtures/resale.ts";
const page = resaleFixture();
const session = {
  walletId: "aaaaaaaa-1111-4111-8111-111111111111",
  walletAddress: page.ownerWallet,
  cluster: "localnet" as const,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
};
function fixture() {
  let auth: WalletSessionSnapshot = { status: "signed-in", session, error: null };
  const review = {
    ...page,
    custodyState: "COLLECTOR_HELD" as const,
    canList: false,
    canRequest: true,
    inspection: { ...page.inspection, status: "REQUIRED" as const },
  };
  const listeners = new Set<() => void>();
  let writes = 0;
  const methods = {
    getSnapshot: () => auth,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    readResale: async () => review,
    requestResale: async () => {
      writes++;
      return { ...review, canRequest: false };
    },
  };
  return {
    methods,
    get writes() {
      return writes;
    },
    change() {
      auth = { status: "signed-out", session: null, error: null };
      for (const fn of listeners) fn();
    },
  };
}
test("collector requests coordination without granting its own resale approval", async () => {
  const f = fixture(),
    c = createResaleWorkflow(f.methods, page.kathaId);
  await c.request();
  assert.equal(f.writes, 0);
  await c.read();
  await c.request();
  assert.equal(f.writes, 1);
  assert.equal(c.getSnapshot().page?.canList, false);
  await c.request();
  assert.equal(f.writes, 1);
  f.change();
  assert.equal(c.getSnapshot().page, null);
  c.dispose();
});
test("late private inspection data cannot return after session revocation", async () => {
  const f = fixture();
  let resolve!: (value: Awaited<ReturnType<typeof f.methods.readResale>>) => void;
  f.methods.readResale = () =>
    new Promise((r) => {
      resolve = r;
    });
  const c = createResaleWorkflow(f.methods, page.kathaId),
    pending = c.read();
  f.change();
  resolve({
    ...page,
    custodyState: "COLLECTOR_HELD",
    canList: false,
    canRequest: true,
    inspection: { ...page.inspection, status: "REQUIRED" },
  });
  await pending;
  assert.equal(c.getSnapshot().page, null);
  c.dispose();
});
test("inspection failures clear saved requests and redact internal details", async () => {
  const f = fixture(),
    c = createResaleWorkflow(f.methods, page.kathaId);
  await c.read();
  f.methods.readResale = async () => {
    throw new Error("PRIVATE");
  };
  await c.read();
  assert.equal(c.getSnapshot().page, null);
  assert.doesNotMatch(c.getSnapshot().error!, /PRIVATE/);
  c.dispose();
});
test("private inspection HTTP rejects substituted artwork and uses an authenticated uncached boundary", async () => {
  let body = page;
  const api = createWalletSessionApi("http://localhost:3001", async (url, init) => {
    assert.equal(String(url), `http://localhost:3001/resale/artworks/${page.kathaId}`);
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.credentials, "omit");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic");
    return Response.json(body);
  });
  const signal = new AbortController().signal;
  assert.equal(
    (await api.readResale(page.kathaId, "synthetic", signal)).ownerWallet,
    page.ownerWallet,
  );
  body = { ...page, kathaId: "KATHA-PAUBHA-000002" };
  await assert.rejects(api.readResale(page.kathaId, "synthetic", signal));
});
