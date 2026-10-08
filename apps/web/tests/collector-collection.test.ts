import assert from "node:assert/strict";
import { test } from "node:test";
import { createCollectorCollection } from "../lib/collector-collection.ts";
import {
  createWalletSessionApi,
  WalletSessionApiError,
} from "../lib/wallet-session-api.ts";
import { createPublicApi } from "../lib/public-api.ts";
import type { WalletSessionSnapshot } from "../lib/wallet-session.ts";
import { collectionFixture, collectionListingFixture } from "./fixtures/collection.ts";
const page = collectionFixture();
const session = {
  walletId: "aaaaaaaa-1111-4111-8111-111111111111",
  walletAddress: page.walletAddress,
  cluster: "localnet" as const,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
function fixture() {
  let auth: WalletSessionSnapshot = { status: "signed-in", session, error: null };
  const listeners = new Set<() => void>();
  const methods = {
    getSnapshot: () => auth,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    readCollection: async (
      query: { limit: number; offset: number },
      signal: AbortSignal,
    ) => {
      assert.equal(signal.aborted, false);
      return collectionFixture(page.walletAddress, query.offset);
    },
  };
  return {
    methods,
    listeners,
    change(next: WalletSessionSnapshot) {
      auth = next;
      for (const listener of listeners) listener();
    },
  };
}
test("collection scopes transport, validates pagination and rejects duplicates", async () => {
  let body = page;
  const api = createWalletSessionApi("http://localhost:3001", async (url, init) => {
    assert.equal(
      String(url),
      "http://localhost:3001/account/collection?limit=20&offset=0",
    );
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic");
    return Response.json(body);
  });
  const signal = new AbortController().signal;
  assert.equal(
    (await api.readCollection({ limit: 20, offset: 0 }, "synthetic", signal)).items
      .length,
    1,
  );
  body = { ...page, pagination: { ...page.pagination, offset: 20 } };
  await assert.rejects(
    api.readCollection({ limit: 20, offset: 0 }, "synthetic", signal),
  );
  body = { ...page, items: [page.items[0]!, page.items[0]!] };
  await assert.rejects(
    api.readCollection({ limit: 20, offset: 0 }, "synthetic", signal),
  );
});
test("collection pages and listing failures preserve independent custody and lag", async () => {
  const f = fixture();
  const list = createCollectorCollection(f.methods, async () => {
    throw new Error("PRIVATE");
  });
  await list.refresh();
  assert.equal(list.getSnapshot().page?.items[0]?.custody.state, "KATHA_HELD");
  assert.equal(list.getSnapshot().page?.items[0]?.indexing.status, "LAGGING");
  assert.equal(list.getSnapshot().listings[page.items[0]!.artwork.kathaId], null);
  await list.next();
  assert.equal(list.getSnapshot().page?.pagination.offset, 20);
  assert.equal(list.getSnapshot().page?.items.length, 0);
  await list.previous();
  assert.equal(list.getSnapshot().page?.pagination.offset, 0);
  list.dispose();
  assert.equal(f.listeners.size, 0);
});
test("listing observations bind artwork, asset and cluster while exposing changed owners", async () => {
  const f = fixture();
  let listing = collectionListingFixture();
  const list = createCollectorCollection(f.methods, async () => listing);
  listing = { ...listing, asset: "11111111111111111111111111111113" };
  await list.refresh();
  assert.equal(list.getSnapshot().listings[listing.kathaId], null);
  listing = {
    ...collectionListingFixture(),
    owner: "11111111111111111111111111111113",
  };
  await list.refresh();
  assert.equal(list.getSnapshot().listings[listing.kathaId]?.owner, listing.owner);
  assert.equal(list.getSnapshot().page?.items[0]?.ownerWallet, session.walletAddress);
  list.dispose();
});
for (const change of ["signout", "wallet", "dispose"])
  test(`delayed collection data is discarded after ${change}`, async () => {
    const f = fixture();
    let resolve!: (value: typeof page) => void;
    f.methods.readCollection = () =>
      new Promise((done) => {
        resolve = done;
      });
    const list = createCollectorCollection(f.methods, async () =>
      collectionListingFixture(),
    );
    const pending = list.refresh();
    if (change === "dispose") list.dispose();
    else
      f.change(
        change === "signout"
          ? { status: "signed-out", session: null, error: null }
          : {
              status: "signed-in",
              session: {
                ...session,
                walletAddress: "11111111111111111111111111111113",
              },
              error: null,
            },
      );
    resolve(page);
    await pending;
    assert.equal(list.getSnapshot().page, null);
    assert.equal(list.getSnapshot().status, "locked");
    list.dispose();
  });
test("collection errors clear holdings and permit retry; malformed identity stays hidden", async () => {
  const f = fixture(),
    list = createCollectorCollection(f.methods, async () => collectionListingFixture());
  f.methods.readCollection = async () => {
    throw new WalletSessionApiError("UNAUTHENTICATED");
  };
  await list.refresh();
  assert.equal(list.getSnapshot().status, "unavailable");
  f.methods.readCollection = async () =>
    collectionFixture("11111111111111111111111111111113");
  await list.refresh();
  assert.equal(list.getSnapshot().page, null);
  f.methods.readCollection = async () => page;
  await list.refresh();
  assert.equal(list.getSnapshot().status, "ready");
  list.dispose();
});
test("public listing lookup sends no bearer and rejects a different artwork", async () => {
  const api = createPublicApi("http://localhost:3001", {
    fetch: async (url, init) => {
      assert.equal(new Headers(init?.headers).has("Authorization"), false);
      assert.equal(
        String(url),
        `http://localhost:3001/artworks/${page.items[0]!.artwork.kathaId}/listing`,
      );
      return Response.json({
        ...collectionListingFixture(),
        kathaId: "KATHA-PAUBHA-000002",
      });
    },
  });
  await assert.rejects(api.listing(page.items[0]!.artwork.kathaId));
});
