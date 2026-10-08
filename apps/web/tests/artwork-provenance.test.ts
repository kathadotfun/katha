import assert from "node:assert/strict";
import { test } from "node:test";
import {
  artworkProvenanceResponseSchema,
  canonicalDocumentBytes,
  sha256Hex,
} from "@katha/shared";
import {
  checkMetadataIntegrity,
  explorerLink,
  historyOffset,
  validateArtworkHistory,
} from "../lib/artwork-provenance.ts";
import { artworkFixture } from "./fixtures/artwork.ts";
import { metadataBytes, provenanceFixture } from "./fixtures/provenance.ts";

const origin = "http://localhost:3001";
async function committed(bytes = metadataBytes) {
  const documentHash = await sha256Hex(bytes);
  return {
    ...artworkFixture,
    metadata: {
      ...artworkFixture.metadata,
      documentHash,
      uri: `${origin}/storage/public/${documentHash}.json`,
    },
  };
}
function response(
  bytes: Uint8Array,
  headers = { "content-type": "application/json" },
): typeof fetch {
  return async () => new Response(new Uint8Array(bytes), { headers });
}
test("exact canonical bytes match; altered bytes visibly fail integrity", async () => {
  const art = await committed();
  assert.equal(
    (await checkMetadataIntegrity(art, origin, response(metadataBytes))).status,
    "MATCH",
  );
  const tampered = new TextEncoder().encode("{}");
  const result = await checkMetadataIntegrity(art, origin, response(tampered));
  assert.equal(result.status, "MISMATCH");
  assert.equal(result.actualHash, await sha256Hex(tampered));
});
test("hash-matching documents still require canonical format, schema and immutable attribution", async () => {
  const raw = JSON.parse(new TextDecoder().decode(metadataBytes));
  for (const bytes of [
    new TextEncoder().encode(JSON.stringify(raw, null, 2)),
    canonicalDocumentBytes({ ...raw, kathaId: "KATHA-PAUBHA-000002" }),
    canonicalDocumentBytes({
      ...raw,
      artist: { ...raw.artist, artistId: "dddddddd-1111-4111-8111-111111111111" },
    }),
    canonicalDocumentBytes({
      ...raw,
      artist: { ...raw.artist, creatorWallet: artworkFixture.ownership.ownerWallet },
    }),
    canonicalDocumentBytes({ ...raw, privateNotes: "must not be displayed" }),
    new Uint8Array([255]),
  ])
    assert.equal(
      (await checkMetadataIntegrity(await committed(bytes), origin, response(bytes)))
        .status,
      "INVALID",
    );
});
test("metadata fetch never visits arbitrary URI, redirects or credentialed destinations", async () => {
  const art = await committed();
  for (const uri of [
    "http://169.254.169.254/metadata",
    `${origin}/storage/private/test.json`,
    `${art.metadata.uri}?secret=x`,
    `http://user:password@localhost:3001/storage/public/${art.metadata.documentHash}.json`,
  ]) {
    const result = await checkMetadataIntegrity(
      { ...art, metadata: { ...art.metadata, uri } },
      origin,
      async () => {
        assert.fail("must not fetch");
      },
    );
    assert.equal(result.status, "UNSUPPORTED");
  }
  const request: typeof fetch = async (url, options) => {
    assert.equal(url, art.metadata.uri);
    assert.equal(options?.credentials, "omit");
    assert.equal(options?.redirect, "error");
    assert.equal(options?.cache, "no-store");
    return new Response(new Uint8Array(metadataBytes));
  };
  assert.equal((await checkMetadataIntegrity(art, origin, request)).status, "INVALID");
});
test("bounded body, failed HTTP and stalled body never report a match", async () => {
  const art = await committed();
  assert.equal(
    (
      await checkMetadataIntegrity(
        art,
        origin,
        response(new Uint8Array(1024 * 1024 + 1)),
      )
    ).status,
    "INVALID",
  );
  assert.equal(
    (
      await checkMetadataIntegrity(
        art,
        origin,
        async () => new Response(null, { status: 503 }),
      )
    ).status,
    "UNAVAILABLE",
  );
  const stream = new ReadableStream<Uint8Array>({ start() {} });
  const timer = setTimeout(() => {}, 100);
  try {
    assert.equal(
      (
        await checkMetadataIntegrity(
          art,
          origin,
          async () =>
            new Response(stream, { headers: { "content-type": "application/json" } }),
          10,
        )
      ).status,
      "UNAVAILABLE",
    );
  } finally {
    clearTimeout(timer);
  }
});
test("history must match requested identity, attribution, network, asset and page", () => {
  assert.deepEqual(
    validateArtworkHistory(artworkFixture, provenanceFixture, 0),
    provenanceFixture,
  );
  for (const change of [
    { kathaId: "KATHA-PAUBHA-000002" },
    {
      items: [
        {
          ...provenanceFixture.items[0],
          data: {
            assetAddress: artworkFixture.verification.verifierWallet,
            newOwner: artworkFixture.ownership.ownerWallet,
            authorityWallet: artworkFixture.verification.verifierWallet,
          },
        },
      ],
    },
    {
      attribution: {
        ...provenanceFixture.attribution,
        artist: {
          ...provenanceFixture.attribution.artist,
          id: "dddddddd-1111-4111-8111-111111111111",
        },
      },
    },
    { chain: { ...provenanceFixture.chain, cluster: "DEVNET" } },
    {
      chain: {
        ...provenanceFixture.chain,
        coreAssetAddress: artworkFixture.ownership.ownerWallet,
      },
    },
    { pagination: { ...provenanceFixture.pagination, offset: 20 } },
  ])
    assert.throws(() =>
      validateArtworkHistory(artworkFixture, { ...provenanceFixture, ...change }, 0),
    );
});
test("history offsets are bounded and explorer links validate inputs and network", () => {
  assert.equal(historyOffset(undefined), 0);
  assert.equal(historyOffset("20"), 20);
  for (const input of ["01", "1", "-20", "100020", "1e2", ["20", "40"]])
    assert.equal(historyOffset(input), null);
  assert.equal(
    explorerLink("LOCALNET", "address", artworkFixture.chain.coreAssetAddress),
    null,
  );
  assert.equal(explorerLink("DEVNET", "address", "javascript:alert(1)"), null);
  assert.equal(explorerLink("DEVNET", "tx", "bad"), null);
  assert.ok(
    explorerLink(
      "DEVNET",
      "tx",
      artworkFixture.metadata.transaction.signature,
    )?.endsWith("?cluster=devnet"),
  );
});

test("public metadata URLs support the local/LAN demo but reject credentials and non-HTTP schemes", async () => {
  const { publicArtworkDetailSchema } = await import("@katha/shared");
  for (const uri of [
    "http://localhost:3001/document.json",
    "http://192.168.1.87:3001/document.json",
    "https://example.com/document.json",
  ])
    assert.ok(
      publicArtworkDetailSchema.safeParse({
        ...artworkFixture,
        metadata: { ...artworkFixture.metadata, uri },
      }).success,
    );
  for (const uri of [
    "file:///tmp/document.json",
    "https://user:secret@example.com/document.json",
    "https://example.com/document.json#fragment",
  ])
    assert.ok(
      !publicArtworkDetailSchema.safeParse({
        ...artworkFixture,
        metadata: { ...artworkFixture.metadata, uri },
      }).success,
    );
});

test("matched sale history requires buyer and listing authority binding", async () => {
  const { collectingHistoryFixture } = await import("./fixtures/provenance.ts");
  assert.doesNotThrow(() =>
    validateArtworkHistory(artworkFixture, collectingHistoryFixture, 0),
  );
  for (const field of ["buyerWallet", "listingAddress"]) {
    const value = structuredClone(collectingHistoryFixture);
    const event = value.items.find((e) => e.type === "TRANSFER" && e.data.sale);
    assert.ok(event && event.type === "TRANSFER" && event.data.sale);
    if (field === "buyerWallet")
      event.data.sale.buyerWallet = artworkFixture.chain.coreAssetAddress;
    else event.data.sale.listingAddress = artworkFixture.chain.coreAssetAddress;
    assert.throws(() => validateArtworkHistory(artworkFixture, value, 0));
  }
});

test("sale contracts reject malformed amounts and forged private fields without coercion", async () => {
  const { collectingHistoryFixture } = await import("./fixtures/provenance.ts");
  for (const price of ["NaN", "-1", "1e6", "01", "18446744073709551616", "0"]) {
    const value = structuredClone(collectingHistoryFixture);
    const event = value.items.find((e) => e.type === "TRANSFER" && e.data.sale);
    assert.ok(event && event.type === "TRANSFER" && event.data.sale);
    event.data.sale.price = price;
    assert.equal(artworkProvenanceResponseSchema.safeParse(value).success, false);
  }
  const value = structuredClone(collectingHistoryFixture);
  const event = value.items.find((e) => e.type === "CONDITION");
  assert.ok(event && event.type === "CONDITION");
  assert.equal(
    artworkProvenanceResponseSchema.safeParse({
      ...value,
      items: [{ ...event, data: { ...event.data, privateNotes: "PRIVATE" } }],
    }).success,
    false,
  );
});
