import assert from "node:assert/strict";
import { test } from "node:test";
import {
  artworkDraftResponseSchema,
  type ArtworkDraftReadResponse,
} from "@katha/shared";
import { parseArtworkDraftForm } from "../lib/artwork-draft-form.ts";
import { createArtworkDraftEditor } from "../lib/artwork-draft-editor.ts";
import {
  createWalletSessionApi,
  WalletSessionApiError,
} from "../lib/wallet-session-api.ts";
import type { WalletSessionSnapshot } from "../lib/wallet-session.ts";
const uuid = "aaaaaaaa-1111-4111-8111-111111111111";
const artwork = artworkDraftResponseSchema.parse({
  id: uuid,
  kathaId: "KATHA-PAUBHA-000001",
  artistId: uuid,
  category: "PAUBHA",
  title: "Synthetic artwork",
  creationYear: 2026,
  creatorWallet: null,
  authorshipEvidenceHash: null,
  dimensions: null,
  origin: { countryCode: "NP", region: null, locality: null },
  technique: null,
  story: null,
  meaning: null,
  culturalContext: null,
  creationProcess: null,
  materials: ["Silk"],
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
});
const session = {
  walletId: uuid,
  walletAddress: "11111111111111111111111111111112",
  cluster: "localnet" as const,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
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
    readArtworkDraft: async (): Promise<ArtworkDraftReadResponse> => ({
      artwork,
      editable: true,
    }),
    createArtworkDraft: async () => {
      writes++;
      return artwork;
    },
    updateArtworkDraft: async () => {
      writes++;
      return { ...artwork, title: "Edited", updatedAt: "2026-10-06T00:00:00.001Z" };
    },
  };
  return {
    methods,
    writes: () => writes,
    clear() {
      auth = { status: "signed-out", session: null, error: null };
      for (const listener of listeners) listener();
    },
  };
}
test("form validates groups and materials and excludes immutable identity from edits", () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    artistId: uuid,
    category: "PAUBHA",
    creationYear: "2026",
    title: "Synthetic",
    countryCode: "NP",
    materials: "Silk\nMineral pigment",
    story: "Line one\nLine two",
  }))
    form.set(key, value);
  const created = parseArtworkDraftForm(form, uuid);
  assert.ok(created.data);
  form.set("creationRequestId", "bbbbbbbb-1111-4111-8111-111111111111");
  const retained = parseArtworkDraftForm(form, uuid);
  assert.ok(retained.data && "creationRequestId" in retained.data);
  assert.equal(retained.data.creationRequestId, "bbbbbbbb-1111-4111-8111-111111111111");
  form.set("creationRequestId", "invalid");
  assert.equal(parseArtworkDraftForm(form, uuid).data, null);
  form.delete("creationRequestId");
  form.set("heightMm", "10");
  assert.equal(parseArtworkDraftForm(form, uuid).data, null);
  form.set("widthMm", "1e3");
  assert.equal(parseArtworkDraftForm(form, uuid).data, null);
  form.set("widthMm", "20");
  form.set("artistId", "attempted change");
  form.set("creationYear", "1900");
  const edited = parseArtworkDraftForm(form, uuid, artwork);
  assert.ok(edited.data);
  assert.ok(!("artistId" in edited.data));
  assert.ok(!("creationYear" in edited.data));
  assert.deepEqual(edited.data.materials, ["Silk", "Mineral pigment"]);
  assert.equal(edited.data.expectedUpdatedAt, artwork.updatedAt);
  form.set("materials", "Silk\nsilk");
  assert.equal(parseArtworkDraftForm(form, uuid, artwork).data, null);
});
test("permissions, frozen records and uncertain saves prevent writes until a reviewed reload", async () => {
  const denied = fixture(false);
  const noAccess = createArtworkDraftEditor(denied.methods);
  await noAccess.read(artwork.kathaId);
  assert.equal(noAccess.getSnapshot().status, "denied");
  assert.equal(denied.writes(), 0);
  noAccess.dispose();
  const f = fixture();
  const editor = createArtworkDraftEditor(f.methods);
  await editor.read(artwork.kathaId);
  const save = f.methods.updateArtworkDraft;
  f.methods.updateArtworkDraft = async () => {
    throw new WalletSessionApiError("CONFLICT");
  };
  await editor.save({ expectedUpdatedAt: artwork.updatedAt, title: "Edited" });
  assert.equal(editor.getSnapshot().reloadRequired, true);
  f.methods.updateArtworkDraft = save;
  await editor.save({ expectedUpdatedAt: artwork.updatedAt, title: "Edited" });
  assert.equal(f.writes(), 0);
  await editor.read(artwork.kathaId);
  await editor.save({ expectedUpdatedAt: artwork.updatedAt, title: "Edited" });
  assert.equal(f.writes(), 1);
  f.methods.readArtworkDraft = async () => ({ artwork, editable: false });
  await editor.read(artwork.kathaId);
  await editor.save({ expectedUpdatedAt: artwork.updatedAt, title: "Edited" });
  assert.equal(f.writes(), 1);
  editor.dispose();
});
test("late reads and writes cannot restore data after authority changes or disposal", async () => {
  for (const action of ["clear", "dispose"] as const) {
    const f = fixture();
    let finish!: (value: ArtworkDraftReadResponse) => void;
    f.methods.readArtworkDraft = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const editor = createArtworkDraftEditor(f.methods);
    const pending = editor.read(artwork.kathaId);
    await Promise.resolve();
    if (action === "clear") f.clear();
    else editor.dispose();
    finish({ artwork, editable: true });
    await pending;
    assert.equal(editor.getSnapshot().record, null);
    editor.dispose();
  }
});
test("draft API methods enforce read identity, PATCH token and private transport", async () => {
  const api = createWalletSessionApi("http://localhost:3001", async (url, init) => {
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    assert.ok(!String(url).includes("test-token"));
    if (init?.method === "PATCH") {
      assert.equal(JSON.parse(String(init.body)).expectedUpdatedAt, artwork.updatedAt);
      return Response.json({ ...artwork, updatedAt: "2026-10-06T00:00:00.001Z" });
    }
    return Response.json({
      artwork: { ...artwork, kathaId: "KATHA-PAUBHA-000002" },
      editable: true,
    });
  });
  const signal = new AbortController().signal;
  await assert.rejects(api.readArtworkDraft(artwork.kathaId, "test-token", signal));
  await api.updateArtworkDraft(
    artwork.kathaId,
    { expectedUpdatedAt: artwork.updatedAt, title: "Edited" },
    "test-token",
    signal,
  );
});

test("in-flight saves coalesce and discard responses after sign-out", async () => {
  const f = fixture();
  let finish!: (value: typeof artwork) => void;
  let calls = 0;
  f.methods.updateArtworkDraft = () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const editor = createArtworkDraftEditor(f.methods);
  await editor.read(artwork.kathaId);
  const input = { expectedUpdatedAt: artwork.updatedAt, title: "Edited" };
  const pending = editor.save(input);
  await Promise.resolve();
  await editor.save(input);
  assert.equal(calls, 1);
  f.clear();
  finish({ ...artwork, updatedAt: "2026-10-06T00:00:00.001Z" });
  await pending;
  assert.equal(editor.getSnapshot().record, null);
  editor.dispose();
});
