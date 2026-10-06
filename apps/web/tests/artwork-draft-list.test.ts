import assert from "node:assert/strict";
import { test } from "node:test";
import type { ArtworkDraftListResponse } from "@katha/shared";
import { createArtworkDraftList } from "../lib/artwork-draft-list.ts";
import {
  createWalletSessionApi,
  WalletSessionApiError,
} from "../lib/wallet-session-api.ts";
import type { WalletSessionSnapshot } from "../lib/wallet-session.ts";
const session = {
  walletId: "aaaaaaaa-1111-4111-8111-111111111111",
  walletAddress: "11111111111111111111111111111112",
  cluster: "localnet" as const,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
const item = {
  id: session.walletId,
  kathaId: "KATHA-PAUBHA-000001",
  title: "Synthetic unpublished artwork",
  category: "PAUBHA" as const,
  creationYear: 2026,
  artist: {
    id: session.walletId,
    displayName: "Synthetic artist",
    verificationStatus: "UNVERIFIED" as const,
  },
  workflowStatus: "DOCUMENTING" as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
function fixture(admin = true) {
  let auth: WalletSessionSnapshot = { status: "signed-in", session, error: null };
  const listeners = new Set<() => void>();
  const calls: number[] = [];
  const methods = {
    getSnapshot: () => auth,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    permissions: async () => ({ session, admin, verifier: !admin }),
    listArtworkDrafts: async ({
      limit,
      offset,
    }: {
      limit: number;
      offset: number;
    }): Promise<ArtworkDraftListResponse> => {
      calls.push(offset);
      return {
        items: offset ? [] : [item],
        pagination: { limit, offset, hasMore: offset === 0 },
      };
    },
  };
  return {
    methods,
    calls,
    emit() {
      auth = { status: "signed-out", session: null, error: null };
      for (const listener of listeners) listener();
    },
  };
}
test("admin-only list supports pages, empty results and refresh without write capabilities", async () => {
  const f = fixture();
  const list = createArtworkDraftList(f.methods);
  await list.refresh();
  assert.equal(list.getSnapshot().page?.items[0]?.kathaId, item.kathaId);
  await list.next();
  assert.deepEqual(list.getSnapshot().page?.items, []);
  await list.previous();
  assert.equal(list.getSnapshot().page?.pagination.offset, 0);
  await list.refresh();
  assert.deepEqual(f.calls, [0, 20, 0, 0]);
  list.dispose();
  const denied = fixture(false);
  const noAccess = createArtworkDraftList(denied.methods);
  await noAccess.load();
  assert.equal(noAccess.getSnapshot().status, "denied");
  assert.equal(denied.calls.length, 0);
  noAccess.dispose();
});
test("failed pages clear stale records and recover; denied access hides prior data", async () => {
  const f = fixture();
  const list = createArtworkDraftList(f.methods);
  await list.load();
  const original = f.methods.listArtworkDrafts;
  f.methods.listArtworkDrafts = async () => {
    throw new Error("PRIVATE_STORAGE_SENTINEL");
  };
  await list.next();
  assert.equal(list.getSnapshot().page, null);
  assert.equal(list.getSnapshot().status, "unavailable");
  assert.ok(!JSON.stringify(list.getSnapshot()).includes("PRIVATE_STORAGE_SENTINEL"));
  f.methods.listArtworkDrafts = original;
  await list.refresh();
  assert.equal(list.getSnapshot().status, "ready");
  f.methods.listArtworkDrafts = async () => {
    throw new WalletSessionApiError("FORBIDDEN");
  };
  await list.refresh();
  assert.equal(list.getSnapshot().status, "denied");
  assert.equal(list.getSnapshot().page, null);
  list.dispose();
});
test("account changes and disposal discard late pages; simultaneous loads coalesce", async () => {
  const f = fixture();
  let resolve!: (value: ArtworkDraftListResponse) => void;
  let calls = 0;
  f.methods.listArtworkDrafts = () => {
    calls++;
    return new Promise((done) => {
      resolve = done;
    });
  };
  const list = createArtworkDraftList(f.methods);
  const pending = list.load();
  await Promise.resolve();
  await list.refresh();
  assert.equal(calls, 1);
  f.emit();
  resolve({ items: [item], pagination: { limit: 20, offset: 0, hasMore: false } });
  await pending;
  assert.equal(list.getSnapshot().status, "locked");
  assert.equal(list.getSnapshot().page, null);
  list.dispose();
  const disposedFixture = fixture();
  disposedFixture.methods.listArtworkDrafts = () =>
    new Promise((done) => {
      resolve = done;
    });
  const disposedList = createArtworkDraftList(disposedFixture.methods);
  const disposedPending = disposedList.load();
  await Promise.resolve();
  disposedList.dispose();
  resolve({ items: [item], pagination: { limit: 20, offset: 0, hasMore: false } });
  await disposedPending;
  assert.equal(disposedList.getSnapshot().page, null);
  assert.equal(disposedList.getSnapshot().status, "locked");
});
test("draft HTTP client validates pagination binding and keeps bearer out of request URLs", async () => {
  let body = { items: [item], pagination: { limit: 20, offset: 0, hasMore: false } };
  const api = createWalletSessionApi("http://localhost:3001", async (url, init) => {
    assert.equal(String(url), "http://localhost:3001/admin/artworks?limit=20&offset=0");
    assert.equal(init?.method, "GET");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer synthetic-token",
    );
    return Response.json(body);
  });
  const signal = new AbortController().signal;
  await api.listArtworkDrafts({ limit: 20, offset: 0 }, "synthetic-token", signal);
  body = { ...body, pagination: { ...body.pagination, offset: 20 } };
  await assert.rejects(
    api.listArtworkDrafts({ limit: 20, offset: 0 }, "synthetic-token", signal),
  );
  await assert.rejects(
    api.listArtworkDrafts({ limit: 101, offset: 0 }, "synthetic-token", signal),
  );
});
