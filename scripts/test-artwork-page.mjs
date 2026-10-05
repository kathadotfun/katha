import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { artworkFixture } from "../apps/web/tests/fixtures/artwork.ts";

const webDirectory = fileURLToPath(new URL("../apps/web/", import.meta.url));
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { metadataBytes, provenanceFixture } =
  await import("../apps/web/tests/fixtures/provenance.ts");
const metadataHash = createHash("sha256").update(metadataBytes).digest("hex");
let apiOrigin;
let requests = 0;
const api = createServer((request, response) => {
  requests++;
  response.setHeader("Content-Type", "application/json");
  const path = new URL(request.url, "http://localhost").pathname;
  if (path.endsWith("/provenance")) {
    if (path.includes("KATHA-PAUBHA-000001")) {
      const offset = Number(
        new URL(request.url, "http://localhost").searchParams.get("offset"),
      );
      return response.end(
        JSON.stringify({
          ...provenanceFixture,
          items: offset ? [] : provenanceFixture.items,
          pagination: { limit: 20, offset, hasMore: offset === 0 },
        }),
      );
    }
    response.statusCode = 503;
    return response.end("{}");
  }
  if (path === `/storage/public/${metadataHash}.json`)
    return response.end(metadataBytes);
  const id = path.split("/").at(-1);
  if (id === "KATHA-PAUBHA-000001")
    return response.end(
      JSON.stringify({
        ...artworkFixture,
        metadata: {
          ...artworkFixture.metadata,
          documentHash: metadataHash,
          uri: `${apiOrigin}/storage/public/${metadataHash}.json`,
        },
      }),
    );
  if (id === "KATHA-PAUBHA-000002")
    return response.end(
      JSON.stringify({
        ...artworkFixture,
        kathaId: id,
        media: [],
        dimensions: null,
        materials: [],
        story: null,
        meaning: null,
        culturalContext: null,
        creationProcess: null,
      }),
    );
  if (id === "KATHA-PAUBHA-000004") {
    response.statusCode = 503;
    return response.end(JSON.stringify({ message: "PRIVATE_UPSTREAM_SENTINEL" }));
  }
  if (id === "KATHA-PAUBHA-000005") return response.end(JSON.stringify(artworkFixture));
  response.statusCode = 404;
  response.end("{}");
});

function port(server) {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

let web;
try {
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  apiOrigin = `http://127.0.0.1:${port(api)}`;
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const webPort = port(reservation);
  await new Promise((resolve) => reservation.close(resolve));
  web = spawn(
    process.execPath,
    [
      require.resolve("next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(webPort),
    ],
    {
      cwd: webDirectory,
      env: {
        ...process.env,
        NODE_ENV: "production",
        KATHA_PUBLIC_API_ORIGIN: apiOrigin,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  const collect = (chunk) => {
    output = (output + chunk.toString()).slice(-8000);
  };
  web.stdout.on("data", collect);
  web.stderr.on("data", collect);
  web.on("error", collect);
  const origin = `http://127.0.0.1:${webPort}`;
  let ready = false;
  for (let attempt = 0; attempt < 100 && web.exitCode === null; attempt++) {
    try {
      ready = (
        await globalThis.fetch(origin, { signal: globalThis.AbortSignal.timeout(1000) })
      ).ok;
    } catch {
      /* Startup is asynchronous. */
    }
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, `Production server did not start: ${output}`);

  // Next may commit streaming headers before a missing record or error resolves.
  // Assert the boundary and noindex behavior as well as its possible HTTP statuses.
  async function page(id) {
    const response = await globalThis.fetch(`${origin}/art/${id}`, {
      signal: globalThis.AbortSignal.timeout(15000),
      headers: { "User-Agent": "Twitterbot" },
    });
    return { status: response.status, html: await response.text() };
  }
  const success = await page(artworkFixture.kathaId);
  assert.equal(success.status, 200);
  assert.ok(
    success.html.includes(
      '<link rel="canonical" href="https://katha.fun/art/KATHA-PAUBHA-000001"',
    ),
  );
  assert.ok(success.html.includes(artworkFixture.artist.displayName));
  assert.ok(success.html.includes(artworkFixture.story.split("\n")[0]));
  assert.ok(
    success.html.includes(
      `${apiOrigin}/storage/public/${artworkFixture.media[0].contentHash}.png`,
    ),
  );
  assert.equal((success.html.match(/<main(?:\s|>)/g) ?? []).length, 1);
  const visibleMarkup = success.html.replace(/<!--[\s\S]*?-->/g, "");
  for (const text of [
    "Katha verification recorded",
    "Good · Report #1",
    "Physical custody unknown",
    "latest available inspection",
    "Record freshness is unconfirmed",
  ])
    assert.ok(visibleMarkup.includes(text), text);
  assert.ok(success.html.includes(artworkFixture.ownership.ownerWallet));
  assert.ok(visibleMarkup.includes("Digital ownership transferred"));
  assert.ok(visibleMarkup.includes("Metadata bytes match the published commitment"));
  assert.ok(visibleMarkup.includes("?historyOffset=20#provenance"));
  assert.equal(
    requests,
    3,
    "One artwork read, one history read and one metadata document read per render",
  );

  const nextHistory = await page(`${artworkFixture.kathaId}?historyOffset=20`);
  assert.equal(nextHistory.status, 200);
  assert.ok(nextHistory.html.includes("No indexed events"));
  assert.ok(nextHistory.html.includes("?historyOffset=0#provenance"));
  const sparse = await page("KATHA-PAUBHA-000002");
  assert.equal(sparse.status, 200);
  assert.ok(sparse.html.includes("Artwork photography is not available yet."));
  assert.ok(sparse.html.includes("Not yet documented."));
  assert.ok(sparse.html.includes("History is unavailable"));
  assert.ok(sparse.html.includes("Metadata integrity is unchecked"));
  const beforeInvalid = requests;
  const invalid = await page("not-a-permanent-id");
  assert.ok([200, 404].includes(invalid.status));
  assert.ok(invalid.html.includes("noindex"));
  assert.ok(invalid.html.includes("Page not found"));
  assert.equal(requests, beforeInvalid);
  const missing = await page("KATHA-PAUBHA-000003");
  assert.ok([200, 404].includes(missing.status));
  assert.ok(missing.html.includes("Page not found"));
  assert.ok(missing.html.includes("noindex"));
  for (const id of ["KATHA-PAUBHA-000004", "KATHA-PAUBHA-000005"]) {
    const failure = await page(id);
    assert.ok([200, 500].includes(failure.status));
    assert.ok(failure.html.includes("digest"));
    assert.ok(!failure.html.includes("PRIVATE_UPSTREAM_SENTINEL"));
    assert.ok(!failure.html.includes('<h1 id="artwork-title"'));
  }
  globalThis.console.log(
    "Artwork route: success, canonical metadata, one artwork read, indexed transfer, matching metadata, paged/ unavailable history, unsupported metadata, sparse content, invalid/missing IDs, outage and identity mismatch passed.",
  );
} finally {
  if (web?.pid && web.exitCode === null) {
    const stopped = once(web, "exit");
    web.kill("SIGTERM");
    const deadline = setTimeout(() => web.kill("SIGKILL"), 3000);
    try {
      await stopped;
    } finally {
      clearTimeout(deadline);
    }
  }
  api.closeAllConnections();
  await new Promise((resolve) => api.close(resolve));
}
