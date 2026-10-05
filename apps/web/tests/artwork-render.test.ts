import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createPublicApi, PublicApiError } from "../lib/public-api.ts";
import { publicArtworkDetailSchema } from "@katha/shared";
import { artworkFixture } from "./fixtures/artwork.ts";

const require = createRequire(import.meta.url);

// Node strips types but cannot parse JSX. Compile the real view, with the installed
// workspace compiler, in memory; no generated source or runtime test route needed.
async function viewModule(path: string, aliases: Readonly<Record<string, string>>) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  let code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  for (const [specifier, target] of Object.entries({
    react: pathToFileURL(require.resolve("react")).href,
    "react/jsx-runtime": pathToFileURL(require.resolve("react/jsx-runtime")).href,
    ...aliases,
  }))
    code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(target));
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}

const photoModule = await viewModule("../components/artwork-photo.tsx", {});
const careModule = await viewModule("../components/artwork-care.tsx", {});
const detailModule = await viewModule("../components/artwork-detail.tsx", {
  "./artwork-photo": photoModule,
  "./artwork-care": careModule,
  "../lib/artwork-page": new URL("../lib/artwork-page.ts", import.meta.url).href,
});
const { ArtworkDetail } = await import(detailModule);

function render(artwork = artworkFixture) {
  return renderToStaticMarkup(
    createElement(ArtworkDetail, { artwork, apiOrigin: "http://localhost:3001" }),
  );
}

test("the actual view renders documentation, attribution and approved photography alongside recorded care", () => {
  const html = render();
  for (const content of [
    artworkFixture.title,
    artworkFixture.artist.displayName,
    artworkFixture.kathaId,
    "Real World Assets",
    "Patan, Bagmati, Nepal",
    "720 × 510 mm",
    "Test canvas",
    "The story",
    "Meaning",
    "Cultural context",
    "How it was made",
    "does not automatically transfer copyright",
  ])
    assert.ok(html.includes(content), content);
  assert.equal((html.match(/<h1(?:\s|>)/g) ?? []).length, 1);
  assert.equal((html.match(/<main(?:\s|>)/g) ?? []).length, 0);
  assert.ok(html.includes('aria-labelledby="artwork-title"'));
  assert.ok(
    html.includes(
      `src="http://localhost:3001/storage/public/${artworkFixture.media[0]!.contentHash}.png"`,
    ),
  );
  assert.ok(html.includes('alt="Synthetic artwork image for testing"'));
  assert.ok(html.includes('loading="eager"'));
  assert.ok(
    html.includes('referrerPolicy="no-referrer"') ||
      html.includes('referrerpolicy="no-referrer"'),
  );
  assert.ok(!html.includes("/artists/")); // Artist route arrives in step 084.
  assert.ok(!html.includes(artworkFixture.ownership.ownerWallet));
  assert.ok(html.includes("Katha verification recorded"));
});

test("missing documentation and photographs remain explicit without invented artwork", () => {
  const html = render({
    ...artworkFixture,
    media: [],
    dimensions: null,
    origin: { countryCode: "NP", region: null, locality: null },
    materials: [],
    technique: null,
    story: null,
    meaning: null,
    culturalContext: null,
    creationProcess: null,
  });
  assert.ok(html.includes("Artwork photography is not available yet."));
  assert.ok(html.includes("Not documented"));
  assert.equal((html.match(/Not yet documented\./g) ?? []).length, 4);
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("A closer look"));
});

test("detail photos are labelled and lazy, missing alt text stays meaningful", () => {
  const hero = artworkFixture.media[0]!;
  const html = render({
    ...artworkFixture,
    media: [
      hero,
      {
        ...hero,
        id: "cccccccc-1111-4111-8111-111111111111",
        role: "DETAIL",
        position: 1,
        altText: null,
      },
    ],
  });
  assert.ok(html.includes("A closer look"));
  assert.ok(html.includes("Detail view"));
  assert.ok(html.includes('loading="lazy"'));
  assert.ok(html.includes('alt="Synthetic Paubha study — detail view"'));
});

test("artist and artwork text is escaped, never interpreted as HTML", () => {
  const payload = '<script>alert("unsafe")</script>';
  const html = render({
    ...artworkFixture,
    title: payload,
    artist: { ...artworkFixture.artist, displayName: payload },
    story: payload,
  });
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
});

test("verification and inspection times are distinct, UTC and bound to semantic sections", () => {
  const html = render({
    ...artworkFixture,
    verification: {
      ...artworkFixture.verification,
      inspectedAt: "2026-09-20T13:45:00.000Z",
      transaction: {
        ...artworkFixture.verification.transaction,
        recordedAt: "2026-09-21T01:15:00.000Z",
      },
    },
    condition: {
      ...artworkFixture.condition,
      inspectedAt: "2026-10-01T02:30:00.000Z",
      version: 3,
    },
  });
  for (const label of ["artwork-authenticity", "artwork-condition", "artwork-custody"])
    assert.ok(html.includes(`aria-labelledby="${label}"`));
  for (const text of [
    "20 Sept 2026, 13:45 UTC",
    "21 Sept 2026, 01:15 UTC",
    "1 Oct 2026, 02:30 UTC",
    "Good · Report #3",
    "Initial verification",
    "latest available inspection",
    "Earlier reports remain",
    "does not independently authenticate",
    "Record freshness is unconfirmed",
  ])
    assert.ok(html.includes(text), text);
  assert.ok(
    html.includes('datetime="2026-09-20T13:45:00.000Z"') ||
      html.includes('dateTime="2026-09-20T13:45:00.000Z"'),
  );
});

test("every condition grade and inspection purpose has an explicit display label", () => {
  for (const [grade, label] of Object.entries({
    EXCELLENT: "Excellent",
    GOOD: "Good",
    FAIR: "Fair",
    POOR: "Poor",
    DAMAGED: "Damaged",
  })) {
    const artwork = publicArtworkDetailSchema.parse({
      ...artworkFixture,
      condition: { ...artworkFixture.condition, grade },
    });
    assert.ok(render(artwork).includes(`${label} · Report #1`));
  }
  for (const [reason, label] of Object.entries({
    INITIAL_VERIFICATION: "Initial verification",
    PRE_SALE: "Before sale",
    POST_DELIVERY: "After delivery",
    PRE_RESALE: "Before resale",
    RETURN_TO_CUSTODY: "Return to custody",
    INSURANCE: "Insurance inspection",
  })) {
    const artwork = publicArtworkDetailSchema.parse({
      ...artworkFixture,
      condition: { ...artworkFixture.condition, reason },
    });
    const html = render(artwork);
    assert.ok(html.includes(label));
    if (reason === "PRE_RESALE")
      assert.ok(html.includes("does not establish resale approval"));
  }
});

test("dated manual custody is described without asserting digital ownership or delivery", () => {
  for (const [state, label] of Object.entries({
    KATHA_HELD: "Recorded in Katha custody",
    COLLECTOR_HELD: "Recorded with a collector",
    IN_TRANSIT: "Recorded in transit",
  })) {
    const artwork = publicArtworkDetailSchema.parse({
      ...artworkFixture,
      custody: {
        state,
        source: "MANUAL_OBSERVATION",
        observedAt: "2026-09-30T04:00:00.000Z",
      },
    });
    const html = render(artwork);
    assert.ok(html.includes(label));
    assert.ok(html.includes("30 Sept 2026, 04:00 UTC"));
    assert.ok(html.includes("Digital ownership can change without moving"));
    assert.ok(!html.includes(artwork.ownership.ownerWallet));
    if (state === "IN_TRANSIT") assert.ok(html.includes("does not confirm receipt"));
  }
});

test("unknown or inconsistent custody observations never claim possession", () => {
  for (const custody of [
    artworkFixture.custody,
    { state: "KATHA_HELD", source: "UNKNOWN", observedAt: "2026-10-05T00:00:00.000Z" },
    { state: "COLLECTOR_HELD", source: "MANUAL_OBSERVATION", observedAt: null },
    {
      state: "UNKNOWN",
      source: "MANUAL_OBSERVATION",
      observedAt: "2026-10-05T00:00:00.000Z",
    },
  ]) {
    const html = render(
      publicArtworkDetailSchema.parse({ ...artworkFixture, custody }),
    );
    assert.ok(html.includes("Physical custody unknown"));
    assert.ok(html.includes("No holder or delivery status is inferred"));
    assert.ok(!html.includes("Last physical observation"));
  }
});

test("gaps and private fields do not become certainty or public report content", () => {
  const extended = {
    ...artworkFixture,
    privateEvidence: "PRIVATE_EVIDENCE_SENTINEL",
    condition: {
      ...artworkFixture.condition,
      notes: "PRIVATE_NOTES_SENTINEL",
      mediaHashes: ["PRIVATE_PHOTO_SENTINEL"],
    },
    indexing: { ...artworkFixture.indexing, freshness: "GAP_DETECTED" as const },
  };
  const html = render(extended);
  assert.ok(html.includes("Some history is missing"));
  for (const text of [
    "PRIVATE_EVIDENCE_SENTINEL",
    "PRIVATE_NOTES_SENTINEL",
    "PRIVATE_PHOTO_SENTINEL",
    "Resale approved",
  ])
    assert.ok(!html.includes(text));
  assert.ok(!publicArtworkDetailSchema.safeParse(extended).success);
});

test("unverified or missing/invalid inspection records fail the public boundary before display", async () => {
  for (const record of [
    {
      ...artworkFixture,
      verification: { ...artworkFixture.verification, status: "UNVERIFIED" },
    },
    { ...artworkFixture, verification: null },
    { ...artworkFixture, condition: null },
    { ...artworkFixture, condition: { ...artworkFixture.condition, grade: "UNKNOWN" } },
    {
      ...artworkFixture,
      condition: { ...artworkFixture.condition, inspectedAt: "not-a-time" },
    },
  ]) {
    const api = createPublicApi("http://localhost:3001", {
      fetch: async () =>
        new Response(JSON.stringify(record), {
          headers: { "Content-Type": "application/json" },
        }),
    });
    await assert.rejects(
      api.artwork(artworkFixture.kathaId),
      (error: unknown) =>
        error instanceof PublicApiError && error.kind === "INVALID_RESPONSE",
    );
  }
});
