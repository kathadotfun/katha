import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
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
import { artistFixture } from "../apps/web/tests/fixtures/artist.ts";

const webDirectory = fileURLToPath(new URL("../apps/web/", import.meta.url));
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { metadataBytes, provenanceFixture, collectingHistoryFixture } =
  await import("../apps/web/tests/fixtures/provenance.ts");
const metadataHash = createHash("sha256").update(metadataBytes).digest("hex");
let apiOrigin;
let requests = 0;
let homeMode = "READY";
let longContent = false;
let artworkOutage = false;
const longTitle = "Synthetic".repeat(20);
const api = createServer((request, response) => {
  requests++;
  response.setHeader("Content-Type", "application/json");
  const path = new URL(request.url, "http://localhost").pathname;
  if (path.startsWith("/artists/")) {
    const slug = path.split("/").at(-1);
    if (slug === artistFixture.slug)
      return response.end(
        JSON.stringify({
          ...artistFixture,
          ...(longContent ? { biography: "Synthetic".repeat(150) } : {}),
        }),
      );
    if (slug === "empty-artist")
      return response.end(
        JSON.stringify({
          ...artistFixture,
          slug,
          id: "dddddddd-1111-4111-8111-111111111111",
        }),
      );
    if (slug === "unavailable-works")
      return response.end(
        JSON.stringify({
          ...artistFixture,
          slug,
          id: "ffffffff-1111-4111-8111-111111111111",
        }),
      );
    if (slug === "wrong-profile") return response.end(JSON.stringify(artistFixture));
    if (slug === "unavailable-profile") {
      response.statusCode = 503;
      return response.end(JSON.stringify({ message: "PRIVATE_UPSTREAM_SENTINEL" }));
    }
    response.statusCode = 404;
    return response.end("{}");
  }
  if (path === "/artworks") {
    const query = new URL(request.url, "http://localhost").searchParams;
    const artistId = query.get("artistId");
    const isHome = query.get("limit") === "3";
    if (isHome && homeMode === "UNAVAILABLE") {
      response.statusCode = 503;
      return response.end(JSON.stringify({ message: "PRIVATE_UPSTREAM_SENTINEL" }));
    }
    if (artistId === "ffffffff-1111-4111-8111-111111111111") {
      response.statusCode = 503;
      return response.end("{}");
    }
    const category = query.get("category");
    const offset = Number(query.get("offset"));
    if (category === "MANDALA") {
      response.statusCode = 503;
      return response.end(JSON.stringify({ message: "PRIVATE_UPSTREAM_SENTINEL" }));
    }
    const summary = {
      kathaId: artworkFixture.kathaId,
      category: artworkFixture.category,
      title: longContent ? longTitle : artworkFixture.title,
      creationYear: artworkFixture.creationYear,
      artist: artworkFixture.artist,
      heroImage: {
        id: artworkFixture.media[0].id,
        contentHash: artworkFixture.media[0].contentHash,
        mimeType: "image/png",
        altText: "Synthetic catalogue photograph",
      },
    };
    return response.end(
      JSON.stringify({
        items:
          (isHome && homeMode === "EMPTY") ||
          category === "THANGKA" ||
          offset === 12 ||
          artistId === "dddddddd-1111-4111-8111-111111111111"
            ? []
            : [summary],
        pagination: {
          limit: Number(query.get("limit")),
          offset,
          hasMore: offset === 0 && category !== "THANGKA",
        },
      }),
    );
  }
  if (path.endsWith("/provenance")) {
    if (path.includes("KATHA-PAUBHA-000001")) {
      const offset = Number(
        new URL(request.url, "http://localhost").searchParams.get("offset"),
      );
      return response.end(
        JSON.stringify({
          ...provenanceFixture,
          items: offset ? [] : collectingHistoryFixture.items,
          pagination: { limit: 20, offset, hasMore: offset === 0 },
        }),
      );
    }
    response.statusCode = 503;
    return response.end("{}");
  }
  if (path === `/storage/public/${metadataHash}.json`)
    return response.end(metadataBytes);
  if (path === `/storage/public/${artworkFixture.media[0].contentHash}.png`) {
    response.setHeader("Content-Type", "image/png");
    // A synthetic one-pixel PNG; no artist evidence or external image fetch.
    return response.end(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    );
  }
  const id = path.split("/").at(-1);
  if (id === "KATHA-PAUBHA-000001" && artworkOutage) {
    response.statusCode = 503;
    return response.end(JSON.stringify({ message: "PRIVATE_UPSTREAM_SENTINEL" }));
  }
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
        KATHA_PUBLIC_APP_ORIGIN: `http://127.0.0.1:${webPort}`,
        KATHA_CLUSTER: "localnet",
        KATHA_PUBLIC_SOLANA_RPC_URL: "http://127.0.0.1:8899",
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
        await globalThis.fetch(`${origin}/brand/katha-profile.svg`, {
          signal: globalThis.AbortSignal.timeout(1000),
        })
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
  for (const text of [
    "Primary purchase",
    "Secondary purchase",
    "Condition report 2",
    "Photo SHA-256",
    "Custody revision 3",
    "1000000",
    "Artist royalty 50000",
  ])
    assert.ok(visibleMarkup.includes(text), text);
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
    assert.ok(failure.html.includes("Artwork information unavailable | Katha"));
    assert.ok(failure.html.includes("noindex"));
    assert.ok(!failure.html.includes("PRIVATE_UPSTREAM_SENTINEL"));
    assert.ok(!failure.html.includes('<h1 id="artwork-title"'));
  }
  async function explore(query = "") {
    const response = await globalThis.fetch(`${origin}/explore${query}`, {
      headers: { "User-Agent": "Twitterbot" },
      signal: globalThis.AbortSignal.timeout(15000),
    });
    return {
      status: response.status,
      html: (await response.text()).replace(/<!--[\s\S]*?-->/g, ""),
    };
  }
  const catalogue = await explore("?category=PAUBHA");
  assert.equal(catalogue.status, 200);
  for (const text of [
    "Explore the artworks",
    artworkFixture.title,
    artworkFixture.artist.displayName,
    `/storage/public/${artworkFixture.media[0].contentHash}.png`,
    'href="/art/KATHA-PAUBHA-000001"',
    "category=PAUBHA&amp;offset=12",
  ])
    assert.ok(catalogue.html.includes(text), text);
  const paged = await explore("?category=PAUBHA&offset=12");
  assert.ok(paged.html.includes("No artworks on this page"));
  assert.ok(paged.html.includes("Return to the first page"));
  const emptyCategory = await explore("?category=THANGKA");
  assert.ok(emptyCategory.html.includes("No published artworks yet"));
  const unavailableCategory = await explore("?category=MANDALA");
  assert.ok(unavailableCategory.html.includes("Artworks are unavailable right now"));
  assert.ok(unavailableCategory.html.includes("/explore?category=MANDALA"));
  assert.ok(!unavailableCategory.html.includes("PRIVATE_UPSTREAM_SENTINEL"));
  const beforeBadFilters = requests;
  for (const query of [
    "?category=paubha",
    "?category=PAUBHA&category=THANGKA",
    "?offset=1",
    "?limit=100",
  ]) {
    const invalidFilters = await explore(query);
    assert.ok(invalidFilters.html.includes("These filters"));
    assert.ok(invalidFilters.html.includes("noindex"));
  }
  assert.equal(
    requests,
    beforeBadFilters,
    "Invalid exploration queries must not fetch",
  );
  const home = await globalThis.fetch(origin).then((response) => response.text());
  assert.ok(home.includes('href="/explore"'));
  assert.ok(home.includes('href="/art/KATHA-PAUBHA-000001"'));
  assert.ok(home.includes('href="/artists/synthetic-artist"'));
  assert.ok(home.includes('href="https://katha.fun/"'));
  assert.ok(home.includes('id="purpose"') && home.includes('id="traditions"'));
  assert.ok(home.includes("Real World Assets, rooted in Nepali culture."));
  for (const [mode, message] of [
    ["EMPTY", "No published artworks are available yet"],
    ["UNAVAILABLE", "Featured artworks are temporarily unavailable"],
  ]) {
    homeMode = mode;
    const fallback = await globalThis.fetch(origin).then((response) => response.text());
    assert.ok(fallback.includes(message));
    assert.ok(fallback.includes('id="traditions"'));
    assert.ok(!fallback.includes("PRIVATE_UPSTREAM_SENTINEL"));
    assert.ok(!fallback.includes('href="/art/KATHA-PAUBHA-000001"'));
  }
  homeMode = "READY";
  async function artistPage(slug) {
    const response = await globalThis.fetch(`${origin}/artists/${slug}`, {
      headers: { "User-Agent": "Twitterbot" },
      signal: globalThis.AbortSignal.timeout(15000),
    });
    return {
      status: response.status,
      html: (await response.text()).replace(/<!--[\s\S]*?-->/g, ""),
    };
  }
  const beforeProfile = requests;
  const profile = await artistPage(artistFixture.slug);
  assert.equal(profile.status, 200);
  for (const text of [
    artistFixture.displayName,
    artistFixture.biography.split("\n")[0],
    artistFixture.region,
    "Art traditions",
    "Artworks by",
    'href="/art/KATHA-PAUBHA-000001"',
    `https://katha.fun/artists/${artistFixture.slug}`,
  ])
    assert.ok(profile.html.includes(text), text);
  assert.equal(
    requests - beforeProfile,
    2,
    "One shared artist read and one independent published-works read",
  );
  assert.ok(!profile.html.includes(artworkFixture.ownership.ownerWallet));
  const artistPaged = await artistPage(`${artistFixture.slug}?offset=12`);
  assert.ok(artistPaged.html.includes("No published artworks on this page"));
  const artistEmpty = await artistPage("empty-artist");
  assert.ok(
    artistEmpty.html.includes("This does not mean the artist has created no works"),
  );
  const worksUnavailable = await artistPage("unavailable-works");
  assert.ok(worksUnavailable.html.includes("Published artworks are unavailable"));
  assert.ok(worksUnavailable.html.includes(artistFixture.biography.split("\n")[0]));
  const beforeInvalidArtist = requests;
  const invalidArtist = await artistPage("invalid_slug");
  assert.ok(invalidArtist.html.includes("Page not found"));
  assert.ok(invalidArtist.html.includes("noindex"));
  assert.equal(requests, beforeInvalidArtist);
  for (const slug of ["missing-artist", "private-artist"]) {
    const missingArtist = await artistPage(slug);
    assert.ok(missingArtist.html.includes("Page not found"));
    assert.ok(missingArtist.html.includes("noindex"));
  }
  for (const slug of ["wrong-profile", "unavailable-profile"]) {
    const failedArtist = await artistPage(slug);
    assert.ok(failedArtist.html.includes("digest"));
    assert.ok(failedArtist.html.includes("Artist information unavailable | Katha"));
    assert.ok(failedArtist.html.includes("noindex"));
    assert.ok(!failedArtist.html.includes("PRIVATE_UPSTREAM_SENTINEL"));
    assert.ok(!failedArtist.html.includes('<h1 id="artist-name"'));
  }
  assert.ok(success.html.includes(`href="/artists/${artistFixture.slug}"`));
  assert.ok(catalogue.html.includes(`href="/artists/${artistFixture.slug}"`));
  if (process.argv.includes("--account")) {
    const { runCollectorAccountJourney } = await import("./test-collector-account.mjs");
    await runCollectorAccountJourney({ origin, apiOrigin });
  }
  if (process.argv.includes("--browser")) {
    const { runPublicBrowsingJourneys } = await import("./test-public-browsing.mjs");
    await runPublicBrowsingJourneys({
      origin,
      apiOrigin,
      setHomeMode: (mode) => {
        homeMode = mode;
      },
      setLongContent: (enabled) => {
        longContent = enabled;
      },
      setArtworkOutage: (enabled) => {
        artworkOutage = enabled;
      },
    });
  }
  globalThis.console.log(
    "Artwork route: success, canonical metadata, one artwork read, indexed transfer, matching metadata, paged/ unavailable history, unsupported metadata, sparse content, invalid/missing IDs, outage and identity mismatch; exploration filters, paging, images, empty/unavailable states, invalid query rejection and navigation; artist profile, scoped works, paging, empty/unavailable works, slug validation, missing/unverified profiles, outage, identity mismatch and artist links; homepage cultural content, canonical URL, featured artwork/artist links, empty/unavailable catalogue states and safe upstream errors passed.",
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
