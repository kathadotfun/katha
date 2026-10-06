import assert from "node:assert/strict";
import { test } from "node:test";
import type { ArtistResponse, WalletPermissions } from "@katha/shared";
import { createArtistOnboarding } from "../lib/artist-onboarding.ts";
import {
  createWalletSessionApi,
  WalletSessionApiError,
} from "../lib/wallet-session-api.ts";
import type { WalletSessionSnapshot } from "../lib/wallet-session.ts";
import { parseArtistForm } from "../lib/artist-form.ts";
const id = "aaaaaaaa-1111-4111-8111-111111111111";
const session = {
  walletId: id,
  walletAddress: "11111111111111111111111111111112",
  cluster: "localnet" as const,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
const artist: ArtistResponse = {
  id,
  slug: "synthetic-artist",
  displayName: "Synthetic artist",
  biography: "Synthetic biography",
  region: "Patan",
  traditions: ["Paubha"],
  publicLinks: [],
  profileImageUrl: null,
  creatorWallet: null,
  payoutWallet: null,
  verificationStatus: "UNVERIFIED",
  verifiedByWallet: null,
  verifiedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
function fixture(admin = true, verifier = true) {
  let auth: WalletSessionSnapshot = { status: "signed-in", session, error: null };
  const listeners = new Set<() => void>();
  let writes = 0;
  const methods = {
    getSnapshot: () => auth,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    permissions: async (): Promise<WalletPermissions> => ({ session, admin, verifier }),
    createArtist: async () => {
      writes++;
      return artist;
    },
    readArtist: async () => artist,
    verifyArtist: async () => {
      writes++;
      return {
        ...artist,
        verificationStatus: "VERIFIED" as const,
        verifiedByWallet: session.walletAddress,
        verifiedAt: new Date().toISOString(),
      };
    },
  };
  return {
    methods,
    writes: () => writes,
    emit() {
      auth = { status: "signed-out", session: null, error: null };
      for (const listener of listeners) listener();
    },
  };
}
test("manual creation and explicit verification preserve independent roles", async () => {
  for (const [admin, verifier] of [
    [true, false],
    [false, true],
    [false, false],
    [true, true],
  ]) {
    const f = fixture(admin, verifier);
    const flow = createArtistOnboarding(f.methods);
    await flow.check();
    assert.equal(flow.getSnapshot().status, admin || verifier ? "ready" : "denied");
    const input = {
      slug: artist.slug,
      displayName: artist.displayName,
      biography: artist.biography,
      region: artist.region,
      traditions: artist.traditions,
    };
    await flow.create(input);
    assert.equal(f.writes(), admin ? 1 : 0);
    await flow.read(id);
    await flow.verify(false);
    assert.equal(f.writes(), admin ? 1 : 0);
    await flow.verify(true);
    assert.equal(f.writes(), Number(admin) + Number(verifier));
    flow.dispose();
  }
});
test("account change aborts late permission and write results; duplicate clicks send one write", async () => {
  const f = fixture();
  const flow = createArtistOnboarding(f.methods);
  await flow.check();
  let finish!: (value: ArtistResponse) => void;
  let calls = 0;
  f.methods.createArtist = () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const input = {
    slug: artist.slug,
    displayName: artist.displayName,
    biography: artist.biography,
    region: artist.region,
    traditions: artist.traditions,
  };
  const pending = flow.create(input);
  await flow.create(input);
  assert.equal(calls, 1);
  f.emit();
  finish(artist);
  await pending;
  assert.equal(flow.getSnapshot().artist, null);
  assert.equal(flow.getSnapshot().status, "locked");
  flow.dispose();
  const g = fixture();
  let grant!: (value: WalletPermissions) => void;
  g.methods.permissions = () =>
    new Promise((resolve) => {
      grant = resolve;
    });
  const guarded = createArtistOnboarding(g.methods);
  const checking = guarded.check();
  g.emit();
  grant({ session, admin: true, verifier: true });
  await checking;
  assert.equal(guarded.getSnapshot().permissions, null);
  guarded.dispose();
});
test("failed review clears prior target; forbidden writes remove access; private errors are redacted", async () => {
  const f = fixture();
  const flow = createArtistOnboarding(f.methods);
  await flow.check();
  await flow.read(id);
  f.methods.readArtist = async () => {
    throw new Error("PRIVATE_BACKEND_SENTINEL");
  };
  await flow.read(id);
  assert.equal(flow.getSnapshot().artist, null);
  assert.ok(!JSON.stringify(flow.getSnapshot()).includes("PRIVATE_BACKEND_SENTINEL"));
  f.methods.createArtist = async () => {
    throw new WalletSessionApiError("FORBIDDEN");
  };
  await flow.create({
    slug: artist.slug,
    displayName: artist.displayName,
    biography: artist.biography,
    region: artist.region,
    traditions: artist.traditions,
  });
  assert.equal(flow.getSnapshot().permissions, null);
  assert.equal(flow.getSnapshot().status, "denied");
  flow.dispose();
});
test("form validation allows wallet-free Nepali attribution and rejects unsafe URLs, slugs and zero wallets", () => {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    slug: "synthetic-artist",
    displayName: "कला कलाकार",
    biography: "Synthetic\nbiography",
    region: "Patan",
    traditions: "Paubha\nThangka",
  }))
    data.set(key, value);
  assert.deepEqual(parseArtistForm(data).data?.traditions, ["Paubha", "Thangka"]);
  assert.equal(parseArtistForm(data).data?.creatorWallet, null);
  data.set("slug", "bad slug");
  data.set("payoutWallet", "11111111111111111111111111111111");
  data.set("publicLinks", "https://user:secret@example.com");
  const invalid = parseArtistForm(data);
  assert.equal(invalid.data, null);
  assert.deepEqual(Object.keys(invalid.errors).sort(), [
    "payoutWallet",
    "publicLinks",
    "slug",
  ]);
});
test("authenticated client uses exact routes and private headers, validates bindings and maps safe errors", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  let status = 200;
  let body: unknown = { session, admin: true, verifier: false };
  const api = createWalletSessionApi("http://localhost:3001", async (url, init) => {
    requests.push({ url: String(url), init: init! });
    return Response.json(body, { status });
  });
  const signal = new AbortController().signal;
  await api.permissions("a".repeat(64), signal);
  assert.equal(requests[0]!.init.method, "GET");
  assert.equal(requests[0]!.init.cache, "no-store");
  assert.equal(requests[0]!.init.credentials, "omit");
  assert.equal(requests[0]!.init.redirect, "error");
  body = artist;
  await api.readArtist(id.toUpperCase(), "token", signal);
  assert.ok(requests.at(-1)!.url.endsWith(`/verifier/artists/${id}`));
  body = { ...artist, id: "bbbbbbbb-1111-4111-8111-111111111111" };
  await assert.rejects(api.readArtist(id, "token", signal));
  for (const [http, code] of [
    [401, "UNAUTHENTICATED"],
    [403, "FORBIDDEN"],
    [409, "CONFLICT"],
    [404, "NOT_FOUND"],
    [500, "UNAVAILABLE"],
  ] as const) {
    status = http;
    body = { error: "PRIVATE_SENTINEL" };
    await assert.rejects(
      api.permissions("token", signal),
      (error: unknown) =>
        error instanceof WalletSessionApiError &&
        error.code === code &&
        !error.message.includes("PRIVATE_SENTINEL"),
    );
  }
});
