import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicApi, PublicApiError, publicApiOrigin } from "../lib/public-api.ts";

const emptyPage = { items: [], pagination: { limit: 20, offset: 0, hasMore: false } };
// Artwork discovery pages also carry the matching total.
const emptyArtworkPage = {
  items: [],
  pagination: { limit: 20, offset: 0, hasMore: false, total: 0 },
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function fails(kind: PublicApiError["kind"]) {
  return (error: unknown) => error instanceof PublicApiError && error.kind === kind;
}

test("public origins reject credentials, paths, query strings and unsafe protocols", () => {
  assert.equal(publicApiOrigin("http://localhost:3001/"), "http://localhost:3001");
  for (const origin of [
    "https://user:secret@example.com",
    "https://example.com/api",
    "https://example.com?token=secret",
    "https://example.com#secret",
    "file:///tmp",
    "invalid",
  ]) {
    assert.throws(() => publicApiOrigin(origin));
  }
});

test("discovery validates filters and sends fresh public reads without cookies or redirects", async () => {
  const api = createPublicApi("http://localhost:3001", {
    fetch: async (url, init) => {
      assert.equal(
        String(url),
        "http://localhost:3001/artworks?limit=20&offset=0&category=PAUBHA",
      );
      assert.equal(init?.method, "GET");
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.cache, "no-store");
      assert.deepEqual(init?.headers, { Accept: "application/json" });
      return json(emptyArtworkPage);
    },
  });
  assert.deepEqual(await api.artworks({ category: "PAUBHA" }), emptyArtworkPage);
});

test("invalid identities and filters fail before making any request", () => {
  const api = createPublicApi("http://localhost:3001", {
    fetch: async () => {
      assert.fail("must not fetch");
    },
  });
  assert.throws(() => api.artwork("../admin/artworks"));
  assert.throws(() => api.artist("artist?secret=1"));
  assert.throws(() => api.artworks({ category: "OTHER" }));
  assert.throws(() => api.artists({ limit: "101" }));
  assert.throws(() => api.provenance("KATHA-PAUBHA-000001", { type: "UNKNOWN" }));
});

test("every public endpoint validates its own response schema", async () => {
  const paths: string[] = [];
  const api = createPublicApi("http://localhost:3001", {
    fetch: async (url) => {
      paths.push(new URL(String(url)).pathname);
      return json(emptyPage);
    },
  });
  assert.deepEqual(await api.artists(), emptyPage);
  await assert.rejects(api.artwork("KATHA-PAUBHA-000001"), fails("INVALID_RESPONSE"));
  await assert.rejects(api.artist("test-artist"), fails("INVALID_RESPONSE"));
  await assert.rejects(
    api.provenance("KATHA-PAUBHA-000001"),
    fails("INVALID_RESPONSE"),
  );
  assert.deepEqual(paths, [
    "/artists",
    "/artworks/KATHA-PAUBHA-000001",
    "/artists/test-artist",
    "/artworks/KATHA-PAUBHA-000001/provenance",
  ]);
});

test("successful but malformed, unknown or private data is never accepted", async () => {
  for (const response of [
    json({ ...emptyPage, privateEvidence: "secret" }),
    json({ items: [{ title: "Unknown" }], pagination: emptyPage.pagination }),
    new Response("not JSON", { headers: { "Content-Type": "application/json" } }),
    new Response("<html>proxy error</html>"),
  ]) {
    await assert.rejects(
      createPublicApi("http://localhost:3001", {
        fetch: async () => response,
      }).artworks(),
      fails("INVALID_RESPONSE"),
    );
  }
});

test("HTTP failures never expose upstream messages or bodies", async () => {
  for (const status of [404, 401, 403, 429, 500, 503]) {
    const response = json({ message: "private upstream detail" }, status);
    await assert.rejects(
      createPublicApi("http://localhost:3001", {
        fetch: async () => response,
      }).artworks(),
      fails(status === 404 ? "NOT_FOUND" : "UNAVAILABLE"),
    );
    assert.equal(response.bodyUsed, false);
  }
  await assert.rejects(
    createPublicApi("http://localhost:3001", {
      fetch: async () => {
        throw new Error("secret URL");
      },
    }).artworks(),
    fails("UNAVAILABLE"),
  );
});

const waitingFetch: typeof fetch = async (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
      once: true,
    });
  });

test("deadline covers fetch and response body; timeout configuration is bounded", async () => {
  // AbortSignal.timeout is unref'ed in Node; keep this synthetic pending request alive.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(
      createPublicApi("http://localhost:3001", {
        fetch: waitingFetch,
        timeoutMs: 5,
      }).artworks(),
      fails("TIMEOUT"),
    );
    await assert.rejects(
      createPublicApi("http://localhost:3001", {
        timeoutMs: 5,
        fetch: async (_url, init) =>
          new Response(
            new ReadableStream({
              start(controller) {
                init?.signal?.addEventListener(
                  "abort",
                  () => controller.error(init.signal?.reason),
                  { once: true },
                );
              },
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
      }).artworks(),
      fails("TIMEOUT"),
    );
  } finally {
    clearInterval(keepAlive);
  }
  for (const timeoutMs of [0, -1, 60_001, NaN, 1.5])
    assert.throws(() => createPublicApi("http://localhost:3001", { timeoutMs }));
});

test("caller cancellation is preserved before and during requests", async () => {
  const controller = new AbortController();
  const api = createPublicApi("http://localhost:3001", { fetch: waitingFetch });
  const pending = api.artworks({}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, fails("CANCELLED"));
  await assert.rejects(
    api.artworks({}, { signal: controller.signal }),
    fails("CANCELLED"),
  );
});
