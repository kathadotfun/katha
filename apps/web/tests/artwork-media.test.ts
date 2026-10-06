import assert from "node:assert/strict";
import { test } from "node:test";
import type { ArtworkMediaResponse } from "@katha/shared";
import { createArtworkMediaManager } from "../lib/artwork-media.ts";
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
const page: ArtworkMediaResponse = {
  kathaId: "KATHA-PAUBHA-000001",
  updatedAt: "2026-10-06T00:00:00.000Z",
  editable: true,
  items: [],
};
const input = {
  expectedUpdatedAt: page.updatedAt,
  mimeType: "image/png" as const,
  role: "FRONT" as const,
  visibility: "PRIVATE" as const,
  altText: null,
  caption: null,
  approvedPublic: false,
};
function fixture(admin = true) {
  let auth: WalletSessionSnapshot = { status: "signed-in", session, error: null };
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
    permissions: async () => ({ session, admin, verifier: false }),
    readArtworkMedia: async (): Promise<ArtworkMediaResponse> => page,
    uploadArtworkMedia: async (): Promise<ArtworkMediaResponse> => {
      writes++;
      return { ...page, updatedAt: "2026-10-06T00:00:00.001Z" };
    },
    updateArtworkMedia: async (): Promise<ArtworkMediaResponse> => {
      writes++;
      return { ...page, updatedAt: "2026-10-06T00:00:00.001Z" };
    },
  };
  return {
    methods,
    writes: () => writes,
    clear() {
      auth = { status: "signed-out", session: null, error: null };
      for (const fn of listeners) fn();
    },
  };
}
test("media permissions, frozen windows and uncertain uploads prevent unchecked writes", async () => {
  const denied = fixture(false);
  const inaccessible = createArtworkMediaManager(denied.methods, page.kathaId);
  await inaccessible.read();
  assert.equal(inaccessible.getSnapshot().status, "denied");
  inaccessible.dispose();
  const f = fixture();
  const manager = createArtworkMediaManager(f.methods, page.kathaId);
  const file = new File(["test"], "test.png", { type: "image/png" });
  await manager.read();
  f.methods.uploadArtworkMedia = async () => {
    throw new WalletSessionApiError("UNAVAILABLE");
  };
  await manager.upload(input, file);
  assert.equal(manager.getSnapshot().reloadRequired, true);
  assert.equal(manager.getSnapshot().page, page);
  await manager.upload(input, file);
  assert.equal(f.writes(), 0);
  f.methods.readArtworkMedia = async () => ({ ...page, editable: false });
  await manager.read();
  await manager.update({ expectedUpdatedAt: page.updatedAt, items: [] });
  assert.equal(f.writes(), 0);
  manager.dispose();
});
test("pending reads and uploads discard data after account changes and disposal", async () => {
  for (const write of [false, true]) {
    const f = fixture();
    let finish!: (value: ArtworkMediaResponse) => void;
    const deferred = () =>
      new Promise<ArtworkMediaResponse>((resolve) => {
        finish = resolve;
      });
    const manager = createArtworkMediaManager(f.methods, page.kathaId);
    if (write) {
      await manager.read();
      f.methods.uploadArtworkMedia = deferred;
    } else f.methods.readArtworkMedia = deferred;
    const pending = write
      ? manager.upload(input, new File(["test"], "test.png", { type: "image/png" }))
      : manager.read();
    await Promise.resolve();
    if (write) f.clear();
    else manager.dispose();
    finish(page);
    await pending;
    assert.equal(manager.getSnapshot().page, null);
    manager.dispose();
  }
});
test("multipart client lets the browser set boundaries and rejects response identity/ordering drift", async () => {
  const api = createWalletSessionApi("http://localhost:3001", async (url, init) => {
    assert.equal(
      String(url),
      `http://localhost:3001/admin/artworks/${page.kathaId}/media`,
    );
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer private-token");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.credentials, "omit");
    if (init?.method === "POST") {
      assert.equal(headers.has("Content-Type"), false);
      assert.ok(init.body instanceof FormData);
      assert.equal(JSON.parse(String(init.body.get("metadata"))).visibility, "PRIVATE");
      assert.equal((init.body.get("file") as File).name, "upload");
    }
    return Response.json({ ...page, updatedAt: "2026-10-06T00:00:00.001Z" });
  });
  const signal = new AbortController().signal;
  await api.uploadArtworkMedia(
    page.kathaId,
    input,
    new File(["test"], "PRIVATE_FILENAME.png", { type: "image/png" }),
    "private-token",
    signal,
  );
  await assert.rejects(
    api.uploadArtworkMedia(
      page.kathaId,
      input,
      new File(["test"], "bad.svg", { type: "image/svg+xml" }),
      "private-token",
      signal,
    ),
  );
  await assert.rejects(
    api.updateArtworkMedia(
      page.kathaId,
      {
        expectedUpdatedAt: page.updatedAt,
        items: [
          {
            id: session.walletId,
            role: "FRONT",
            visibility: "PRIVATE",
            altText: null,
            caption: null,
            approvedPublic: false,
          },
        ],
      },
      "private-token",
      signal,
    ),
  );
});
