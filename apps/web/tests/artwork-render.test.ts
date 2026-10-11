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
const bare: Readonly<Record<string, string>> = {
  react: pathToFileURL(require.resolve("react")).href,
  "react/jsx-runtime": pathToFileURL(require.resolve("react/jsx-runtime")).href,
  "next/link": pathToFileURL(require.resolve("next/link")).href,
  // The retry control calls router.refresh(); static rendering only needs a stub.
  "next/navigation":
    "data:text/javascript,export function useRouter(){return{refresh(){}}}export function usePathname(){return '/'}",
  "@katha/shared": import.meta.resolve("@katha/shared"),
};
const compiled = new Map<string, Promise<string>>();

// Node strips types but cannot parse JSX. Compile the real views, with the installed
// workspace compiler, in memory; relative component imports compile recursively and
// library imports load their real source. No generated files or test routes.
function viewModule(path: string): Promise<string> {
  const url = new URL(path, import.meta.url).href;
  let module = compiled.get(url);
  if (!module) {
    module = (async () => {
      const source = await readFile(new URL(url), "utf8");
      let code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      }).outputText;
      const specifiers = [...code.matchAll(/from "([^"]+)"/g)].map(
        (match) => match[1]!,
      );
      for (const specifier of new Set(specifiers)) {
        const target = specifier.startsWith(".")
          ? specifier.includes("/lib/")
            ? new URL(`${specifier}.ts`, url).href
            : await viewModule(new URL(`${specifier}.tsx`, url).href)
          : bare[specifier];
        assert.ok(target, `Unmapped import ${specifier} in ${path}`);
        code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(target));
      }
      return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
    })();
    compiled.set(url, module);
  }
  return module;
}

const { ArtworkDetail } = await import(
  await viewModule("../components/artwork-detail.tsx")
);
type Detail = typeof artworkFixture;
// React escapes apostrophes; decode them so assertions read like the interface copy.
const text = (html: string) => html.replaceAll("&#x27;", "'");
function render(
  artwork: Detail = artworkFixture,
  extra: Record<string, unknown> = {},
): string {
  return text(
    renderToStaticMarkup(
      createElement(ArtworkDetail, {
        artwork,
        apiOrigin: "http://localhost:3001",
        ...extra,
      }),
    ),
  );
}
function between(html: string, start: string, end: string) {
  const from = html.indexOf(start);
  assert.ok(from >= 0, start);
  const to = html.indexOf(end, from);
  return html.slice(from, to < 0 ? undefined : to);
}

test("the actual view renders documentation, attribution and approved photography alongside recorded care", () => {
  const html = render();
  for (const content of [
    artworkFixture.title,
    artworkFixture.artist.displayName,
    artworkFixture.kathaId,
    "Patan, Bagmati, Nepal",
    "720 × 510 mm",
    "Test canvas",
    "Story",
    "Meaning",
    "Cultural context",
    "How it was made",
    "doesn't automatically transfer its copyright",
    "Attribution to Synthetic test artist is permanent",
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
  assert.ok(html.includes(`href="/artists/${artworkFixture.artist.slug}"`));
  assert.ok(html.includes(artworkFixture.ownership.ownerWallet));
  assert.ok(html.includes("Digital ownership"));
  assert.ok(html.includes("Authenticity verification"));
  // Each status row leads to its own evidence panel.
  for (const id of [
    "ev-verification",
    "ev-condition",
    "ev-custody",
    "ev-ownership",
    "ev-chain",
  ]) {
    assert.ok(html.includes(`href="#${id}"`), id);
    assert.ok(html.includes(`id="${id}"`), id);
  }
});

test("sale status comes only from a matching listing and never implies a reservation", () => {
  const now = 1_800_000_000;
  const listing = (patch: Record<string, unknown> = {}) => ({
    kind: "READY",
    listing: {
      kathaId: artworkFixture.kathaId,
      cluster: "localnet",
      commitment: "finalized",
      observedSlot: "1",
      chainTime: String(now),
      owner: artworkFixture.ownership.ownerWallet,
      asset: artworkFixture.chain.coreAssetAddress,
      currentRevision: "1",
      listing: {
        address: artworkFixture.chain.coreAssetAddress,
        status: "ACTIVE",
        revision: "1",
        completedSales: "0",
        saleKind: "SECONDARY",
        seller: artworkFixture.ownership.ownerWallet,
        paymentMint: artworkFixture.chain.coreAssetAddress,
        decimals: 6,
        price: "12500000",
        createdAt: String(now - 10),
        expiresAt: String(now + 3600),
        active: true,
        ...patch,
      },
    },
  });
  const active = render(artworkFixture, { listing: listing() });
  for (const content of [
    "For sale",
    "12.5",
    "Katha test token",
    "Secondary sale",
    "Reviewing doesn't reserve the work",
    "doesn't transfer its copyright",
    `href="/art/${artworkFixture.kathaId}/purchase"`,
  ])
    assert.ok(active.includes(content), content);
  for (const patch of [
    { active: false },
    { status: "CANCELLED", active: false },
    { expiresAt: String(now) },
  ]) {
    const html = render(artworkFixture, { listing: listing(patch) });
    assert.ok(html.includes("Not for sale right now"));
    assert.ok(!html.includes("For sale<"));
  }
  const unavailable = render(artworkFixture, { listing: { kind: "UNAVAILABLE" } });
  assert.ok(unavailable.includes("Sale status unavailable"));
  assert.ok(unavailable.includes(`href="/art/${artworkFixture.kathaId}/purchase"`));
});

test("an NFC arrival opens the record with an explicit authenticity caveat", () => {
  assert.ok(!render().includes("You tapped a Katha tag"));
  const html = render(artworkFixture, { arrivedByNfc: true });
  assert.ok(html.includes("You tapped a Katha tag"));
  assert.ok(html.includes("the tag alone doesn't prove the painting is authentic"));
  assert.ok(html.includes('href="#identify"'));
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
  } as unknown as Detail);
  assert.ok(html.includes("Artwork photography is not available yet."));
  assert.ok(html.includes("Not documented"));
  assert.equal((html.match(/Not yet documented\./g) ?? []).length, 4);
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("Choose a photo"));
});

test("additional photos are labelled thumbnails, and missing alt text stays meaningful", () => {
  const hero = artworkFixture.media[0]!;
  const html = render({
    ...artworkFixture,
    media: [
      { ...hero, altText: null },
      {
        ...hero,
        id: "cccccccc-1111-4111-8111-111111111111",
        role: "DETAIL",
        position: 1,
        altText: null,
      },
    ],
  } as Detail);
  assert.ok(html.includes("Choose a photo of Synthetic Paubha study"));
  assert.ok(html.includes("Show photo 2: Detail view"));
  assert.ok(html.includes('aria-pressed="true"'));
  assert.ok(html.includes('loading="lazy"'));
  assert.ok(html.includes('alt="Synthetic Paubha study, artwork photograph"'));
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

test("verification and inspection times are distinct, UTC and bound to labelled panels", () => {
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
  for (const id of ["artwork-authenticity", "artwork-condition", "artwork-custody"])
    assert.ok(html.includes(`id="${id}"`));
  for (const content of [
    "20 Sept 2026, 1:45 pm UTC",
    "21 Sept 2026, 1:15 am UTC",
    "1 Oct 2026, 2:30 am UTC",
    "Version 3 (replaces version 2)",
    "Initial verification",
    "latest available inspection",
    "doesn't independently authenticate the physical work",
    "isn't a guarantee of authenticity",
  ])
    assert.ok(html.includes(content), content);
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
    assert.ok(render(artwork as Detail).includes(`</svg>${label}</span>`), label);
  }
  for (const [reason, label] of Object.entries({
    INITIAL_VERIFICATION: "Initial verification",
    PRE_SALE: "Before sale",
    POST_DELIVERY: "After delivery",
    PRE_RESALE: "Before resale",
    RETURN_TO_CUSTODY: "Return to custody",
    INSURANCE: "Insurance",
  })) {
    const artwork = publicArtworkDetailSchema.parse({
      ...artworkFixture,
      condition: { ...artworkFixture.condition, reason },
    });
    const html = render(artwork as Detail);
    assert.ok(html.includes(label));
    if (reason === "PRE_RESALE")
      assert.ok(html.includes("doesn't establish resale approval"));
  }
});

test("dated manual custody is described without asserting digital ownership or delivery", () => {
  for (const [state, label] of Object.entries({
    KATHA_HELD: "Held by Katha",
    COLLECTOR_HELD: "With a collector",
    IN_TRANSIT: "In transit",
  })) {
    const artwork = publicArtworkDetailSchema.parse({
      ...artworkFixture,
      custody: {
        state,
        source: "MANUAL_OBSERVATION",
        observedAt: "2026-09-30T04:00:00.000Z",
      },
    });
    const html = render(artwork as Detail);
    const panel = between(html, 'id="ev-custody"', 'id="ev-ownership"');
    assert.ok(panel.includes(label));
    assert.ok(panel.includes("30 Sept 2026, 4:00 am UTC"));
    assert.ok(panel.includes("recorded separately from digital ownership"));
    assert.ok(!panel.includes(artwork.ownership.ownerWallet));
    if (state === "IN_TRANSIT") assert.ok(panel.includes("doesn't confirm receipt"));
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
      publicArtworkDetailSchema.parse({ ...artworkFixture, custody }) as Detail,
    );
    const panel = between(html, 'id="ev-custody"', 'id="ev-ownership"');
    assert.ok(panel.includes("Not recorded"));
    assert.ok(panel.includes("No holder or delivery status is inferred"));
    assert.ok(!panel.includes("Manual custody observation"));
    assert.ok(html.includes("No dated observation"));
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
  const html = render(extended as Detail);
  assert.ok(html.includes("Some history is missing"));
  for (const content of [
    "PRIVATE_EVIDENCE_SENTINEL",
    "PRIVATE_NOTES_SENTINEL",
    "PRIVATE_PHOTO_SENTINEL",
    "Resale approved",
  ])
    assert.ok(!html.includes(content));
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

const { provenanceFixture } = await import("./fixtures/provenance.ts");
function renderHistory(
  history: unknown = provenanceFixture,
  cluster: "DEVNET" | "LOCALNET" = "LOCALNET",
) {
  return render(
    { ...artworkFixture, chain: { ...artworkFixture.chain, cluster } },
    {
      evidence: {
        history,
        integrity: { status: "MISMATCH", actualHash: "f".repeat(64) },
      },
    },
  );
}
test("provenance renders indexed transfers, exact slots, tampering and network-specific links", () => {
  const html = renderHistory();
  for (const content of [
    "Ownership transferred",
    "Recorded new owner",
    "9007199254740993",
    "Metadata integrity failure",
    "This record's metadata doesn't match its recorded fingerprint",
    "Observed fingerprint",
    "isn't a live ownership check",
    "History freshness is unconfirmed",
  ])
    assert.ok(html.includes(content), content);
  assert.ok(!html.includes("https://explorer.solana.com"));
  assert.ok(!html.includes("Previous owner"));
  const devnet = renderHistory(provenanceFixture, "DEVNET");
  assert.ok(devnet.includes("?cluster=devnet"));
  assert.ok(devnet.includes('rel="noopener noreferrer"'));
});
test("every indexing state, owner mismatch, empty history and pagination remain explicit", () => {
  for (const status of [
    "UNKNOWN",
    "GAP_DETECTED",
    "LAGGING",
    "STALE",
    "AT_OBSERVED_HEAD",
  ] as const) {
    const html = renderHistory({
      ...provenanceFixture,
      items: [],
      pagination: { limit: 20, offset: 20, hasMore: true },
      indexing: {
        ...provenanceFixture.indexing,
        status,
        ownerCheck: {
          status: "MISMATCH",
          observedSlot: "9007199254740993",
          checkedAt: artworkFixture.ownership.observedAt,
        },
      },
    });
    assert.ok(html.includes("No indexed events"));
    assert.ok(html.includes("Don't rely on this owner record"));
    assert.ok(html.includes("Ownership records disagree"));
    assert.ok(html.includes("Sale paused"));
    assert.ok(html.includes("?historyOffset=0#provenance"));
    assert.ok(html.includes("?historyOffset=40#provenance"));
    assert.ok(!html.includes("history is complete"));
    if (status === "LAGGING")
      assert.ok(html.includes("Recent activity is still being indexed"));
    if (status === "GAP_DETECTED")
      assert.ok(html.includes("Some history couldn't be loaded"));
  }
});

test("Registry lifecycle events preserve old commitments and physical inspection times", () => {
  const at = artworkFixture.ownership.observedAt;
  const wallet = artworkFixture.chain.coreAssetAddress;
  const base = provenanceFixture.items[0]!;
  const hash = "e".repeat(64);
  const history = {
    ...provenanceFixture,
    items: [
      {
        ...base,
        id: "00000001-1111-4111-8111-111111111111",
        type: "REGISTRATION" as const,
        data: {
          registryRecordAddress: wallet,
          artistId: artworkFixture.artist.id,
          creatorWallet: null,
          authorshipEvidenceHash: hash,
          registeredBy: wallet,
          registeredAt: at,
        },
      },
      {
        ...base,
        id: "00000002-1111-4111-8111-111111111111",
        type: "VERIFICATION" as const,
        data: { authorshipEvidenceHash: hash, verifierWallet: wallet, verifiedAt: at },
      },
      {
        ...base,
        id: "00000003-1111-4111-8111-111111111111",
        type: "METADATA" as const,
        data: {
          version: 1,
          documentHash: hash,
          revisionAddress: wallet,
          committedBy: wallet,
          committedAt: at,
        },
      },
      {
        ...base,
        id: "00000004-1111-4111-8111-111111111111",
        type: "CONDITION" as const,
        data: {
          version: 1,
          publicMedia: [],
          reportAddress: wallet,
          documentHash: hash,
          grade: "FAIR" as const,
          reason: "PRE_RESALE" as const,
          verifierWallet: wallet,
          inspectedAt: "2026-09-01T00:00:00.000Z",
          recordedAt: at,
        },
      },
      {
        ...base,
        id: "00000005-1111-4111-8111-111111111111",
        type: "CUSTODY" as const,
        data: {
          revision: "1",
          fromState: "UNKNOWN" as const,
          toState: "KATHA_HELD" as const,
          attestedBy: wallet,
          recordedAt: at,
        },
      },
      {
        ...base,
        id: "00000006-1111-4111-8111-111111111111",
        type: "MINT" as const,
        data: {
          assetAddress: wallet,
          initialOwner: wallet,
          metadataVersion: 1,
          metadataHash: hash,
          mintedBy: wallet,
          mintedAt: at,
        },
      },
    ],
  };
  const html = renderHistory(history);
  const timeline = between(html, 'id="provenance"', 'id="ev-chain"');
  for (const label of [
    "Permanent Katha ID issued; attributed to Synthetic test artist",
    "Katha verification recorded",
    "Metadata version 1 committed",
    "Condition report 1: Fair, before resale",
    "Not recorded → Held by Katha",
    "Unique digital asset created",
    hash,
    "1 Sept 2026, 12:00 am UTC",
  ])
    assert.ok(timeline.includes(label), label);
});

const { ArtworkExploration } = await import(
  await viewModule("../components/artwork-exploration.tsx")
);
const summary = {
  kathaId: artworkFixture.kathaId,
  category: artworkFixture.category,
  title: artworkFixture.title,
  creationYear: artworkFixture.creationYear,
  artist: artworkFixture.artist,
  heroImage: {
    id: artworkFixture.media[0]!.id,
    contentHash: artworkFixture.media[0]!.contentHash,
    mimeType: "image/png",
    altText: "Synthetic catalogue photo",
  },
};
function explore(state: unknown) {
  return text(
    renderToStaticMarkup(
      createElement(ArtworkExploration, { apiOrigin: "http://localhost:3001", state }),
    ),
  );
}
test("exploration presents artwork, attribution and real category/pagination links without sale claims", () => {
  const html = explore({
    kind: "READY",
    query: { category: "PAUBHA", offset: 12 },
    page: {
      items: [summary],
      pagination: { limit: 12, offset: 12, hasMore: true },
    },
  });
  for (const content of [
    "permanent ID and a public record",
    artworkFixture.artist.displayName,
    artworkFixture.title,
    'href="/art/KATHA-PAUBHA-000001"',
    ".png",
    "/explore?category=PAUBHA&amp;offset=24",
    'href="/explore?category=PAUBHA"',
    'aria-current="page"',
    "Showing 13 Paubha work",
    "Reset filters",
  ])
    assert.ok(html.includes(content), content);
  assert.ok(!html.includes("Buy now"));
  assert.ok(!html.includes("test token"));
  assert.ok(!html.includes("https://picsum"));
  assert.equal((html.match(/<h1(?:\s|>)/g) ?? []).length, 1);
});
test("artist-filtered exploration names the artist from real results and can be removed", () => {
  const html = explore({
    kind: "READY",
    query: { artistId: artworkFixture.artist.id, offset: 0 },
    page: { items: [summary], pagination: { limit: 12, offset: 0, hasMore: false } },
  });
  assert.ok(html.includes(`Artist: ${artworkFixture.artist.displayName}`));
  assert.ok(html.includes('aria-label="Remove artist filter"'));
  assert.ok(html.includes(`artistId=${artworkFixture.artist.id}`));
});
test("empty, missing-image, invalid-query and unavailable exploration remain explicit and safe", () => {
  for (const [state, content] of [
    [{ kind: "INVALID_QUERY" }, "These filters"],
    [
      { kind: "UNAVAILABLE", query: { category: "THANGKA", offset: 12 } },
      "Your filters are kept",
    ],
    [
      {
        kind: "READY",
        query: { offset: 0 },
        page: { items: [], pagination: { limit: 12, offset: 0, hasMore: false } },
      },
      "No works yet",
    ],
    [
      {
        kind: "READY",
        query: { offset: 12 },
        page: { items: [], pagination: { limit: 12, offset: 12, hasMore: false } },
      },
      "Return to the first page",
    ],
    [
      {
        kind: "READY",
        query: { offset: 0 },
        page: {
          items: [{ ...summary, title: "<script>unsafe</script>", heroImage: null }],
          pagination: { limit: 12, offset: 0, hasMore: false },
        },
      },
      "Photo not available yet",
    ],
  ]) {
    const html = explore(state);
    assert.ok(html.includes(content as string), content as string);
    assert.ok(!html.includes("<script>"));
  }
});

const { ArtistProfile } = await import(
  await viewModule("../components/artist-profile.tsx")
);
const { artistFixture } = await import("./fixtures/artist.ts");
function artist(props: Record<string, unknown>) {
  return text(
    renderToStaticMarkup(
      createElement(ArtistProfile, {
        artist: artistFixture,
        apiOrigin: "http://localhost:3001",
        ...props,
      }),
    ),
  );
}
test("artist profiles show approved biography, traditions, region and permanent authorship without collector data", () => {
  const html = artist({
    works: {
      kind: "READY",
      offset: 0,
      page: { items: [summary], pagination: { limit: 12, offset: 0, hasMore: true } },
    },
  });
  for (const content of [
    artistFixture.displayName,
    artistFixture.region,
    "Paubha",
    "Synthetic artist biography.",
    "Attribution stays with the artist",
    "Buying a work doesn't transfer its copyright",
    "Profile verified",
    'href="/art/KATHA-PAUBHA-000001"',
    "?offset=12#artist-works",
    `artistId=${artistFixture.id}`,
    'rel="noopener noreferrer"',
  ])
    assert.ok(html.includes(content), content);
  assert.ok(!html.includes("Portrait of"));
  assert.ok(!html.includes(artworkFixture.ownership.ownerWallet));
  assert.ok(!html.includes("payoutWallet"));
});
test("artist artwork failures, emptiness and invalid page queries preserve biography and safe content", () => {
  for (const [works, content] of [
    [{ kind: "INVALID_QUERY" }, "This page number isn't supported"],
    [{ kind: "UNAVAILABLE", offset: 12 }, "Works couldn't load"],
    [
      {
        kind: "READY",
        offset: 0,
        page: { items: [], pagination: { limit: 12, offset: 0, hasMore: false } },
      },
      "doesn't mean the artist has created no works",
    ],
  ] as const) {
    const html = artist({
      artist: { ...artistFixture, biography: "<script>unsafe</script>" },
      works,
    });
    assert.ok(html.includes("&lt;script&gt;unsafe&lt;/script&gt;"));
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes(artistFixture.displayName));
    assert.ok(html.includes(content), content);
  }
});

const { KathaHomepage } = await import(await viewModule("../components/home-page.tsx"));
function home(featured: unknown, cluster = "devnet") {
  return text(
    renderToStaticMarkup(
      createElement(KathaHomepage, {
        featured,
        apiOrigin: "http://localhost:3001",
        cluster,
      }),
    ),
  );
}

test("homepage presents cultural purpose, real photographs, attribution and permanent routes", () => {
  const html = home({ kind: "READY", items: [summary] });
  for (const content of [
    "Nepal's cultural art.",
    "RWAs on Solana.",
    "Preserving Nepali culture on chain",
    "An RWA, or real-world asset, is a physical object connected to a verifiable digital record",
    'id="purpose"',
    'id="traditions"',
    'id="collecting"',
    'href="/explore?category=MANDALA"',
    'href="/explore?category=PAUBHA"',
    'href="/explore?category=THANGKA"',
    'href="/art/KATHA-PAUBHA-000001"',
    'href="/artists/synthetic-artist"',
    summary.artist.displayName,
    summary.title,
    "Newar artists of the Kathmandu Valley",
    "Himalayan Buddhist scroll painting",
    "Drawings show the typical layout of each form, not specific works",
    "doesn't prove authenticity on its own",
    "Buying a work doesn't transfer its copyright",
    "Katha currently runs on Solana Devnet",
    "Katha test token, which has no monetary value",
    `src="http://localhost:3001/storage/public/${summary.heroImage.contentHash}.png"`,
    'alt="Synthetic catalogue photo"',
  ])
    assert.ok(html.includes(content), content);
  assert.equal((html.match(/<h1(?:\s|>)/g) ?? []).length, 1);
  assert.equal((html.match(/<main(?:\s|>)/g) ?? []).length, 0);
  assert.ok(!html.includes(artworkFixture.ownership.ownerWallet));
  assert.ok(
    home({ kind: "READY", items: [] }, "localnet").includes("local Solana network"),
  );
});

test("homepage keeps culture and navigation available during empty or failed catalogue reads", () => {
  for (const [featured, message] of [
    [{ kind: "UNAVAILABLE" }, "Featured works didn't load"],
    [{ kind: "READY", items: [] }, "No works are published yet"],
  ]) {
    const html = home(featured);
    assert.ok(html.includes(message as string));
    assert.ok(html.includes('id="traditions"'));
    assert.ok(html.includes('href="/explore"'));
    assert.ok(!html.includes(summary.title));
    assert.ok(!html.includes("PRIVATE"));
  }
});

test("homepage escapes public text and handles missing or unsupported photographs explicitly", () => {
  for (const heroImage of [null, { ...summary.heroImage, mimeType: "image/svg+xml" }]) {
    const html = home({
      kind: "READY",
      items: [{ ...summary, title: "<script>unsafe</script>", heroImage }],
    });
    assert.ok(html.includes("&lt;script&gt;unsafe&lt;/script&gt;"));
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("Photo not available yet"));
    assert.ok(!html.includes("/storage/public/"));
  }
});

test("physical identity points to the permanent record and evidence without claiming NFC proof", () => {
  const html = render();
  const section = between(html, 'id="identify"', 'id="evidence"');
  for (const content of [
    "Identifying this painting",
    artworkFixture.kathaId,
    "720 × 510 mm",
    "A basic tag can be copied or moved",
    "doesn't prove authenticity, ownership or custody",
    "Treat the painting as unverified",
    "Physical inspection remains a manual process",
  ])
    assert.ok(section.includes(content), content);
  assert.ok(section.includes('href="#evidence"'));
  assert.ok(!section.includes(artworkFixture.ownership.ownerWallet));
  assert.ok(!section.includes("/nfc/"));
});

test("physical identity does not invent dimensions or upgrade an absent photo into a physical match", () => {
  const html = render({
    ...artworkFixture,
    dimensions: null,
    media: [],
  } as unknown as Detail);
  const section = between(html, 'id="identify"', 'id="evidence"');
  assert.ok(section.includes("Dimensions aren't documented yet"));
  assert.ok(section.includes("Missing details aren't evidence of a match"));
  assert.ok(!section.includes("720 × 510"));
});

test("two purchases retain artist attribution, separate custody and versioned approved photographs", async () => {
  const { collectingHistoryFixture } = await import("./fixtures/provenance.ts");
  const html = renderHistory(collectingHistoryFixture);
  const timeline = between(html, 'id="provenance"', 'id="ev-chain"');
  for (const content of [
    "Primary sale",
    "Secondary sale",
    "Condition report 1",
    "Condition report 2",
    "Revision 3",
    "Photo SHA-256",
    "1000000 base units",
    "Artist royalty 0.05",
    artworkFixture.artist.displayName,
  ])
    assert.ok(timeline.includes(content), content);
  assert.equal((timeline.match(/Primary sale/g) ?? []).length, 1);
  assert.equal((timeline.match(/Secondary sale/g) ?? []).length, 1);
  assert.ok(html.includes("Approved synthetic resale inspection photograph"));
  assert.ok(!html.includes("shippingAddress"));
});
