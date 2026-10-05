import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
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
const detailModule = await viewModule("../components/artwork-detail.tsx", {
  "./artwork-photo": photoModule,
  "../lib/artwork-page": new URL("../lib/artwork-page.ts", import.meta.url).href,
});
const { ArtworkDetail } = await import(detailModule);

function render(artwork = artworkFixture) {
  return renderToStaticMarkup(
    createElement(ArtworkDetail, { artwork, apiOrigin: "http://localhost:3001" }),
  );
}

test("the actual view renders documentation, attribution and approved photography without trust claims", () => {
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
  assert.ok(!html.includes("VERIFIED"));
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
