import { describe, expect, it } from "vitest";

import { artworkSchema } from "../src/artwork-domain.js";
import { canonicalDocumentBytes, sha256Hex } from "../src/canonical-document.js";
import { conditionReportDocumentSchema } from "../src/condition-report.js";

const text = (value: unknown) =>
  new TextDecoder().decode(canonicalDocumentBytes(value));

const artwork = () => ({
  kathaId: "KATHA-PAUBHA-000001",
  category: "PAUBHA",
  title: "Lotus Paubha",
  attribution: {
    artistId: "e9ef8e61-6b79-42cc-ae58-2e9a82610347",
    displayName: "Asha Lama",
  },
  authorshipEvidenceHash: "a".repeat(64),
  creationYear: 2025,
  origin: { countryCode: "NP", region: "Bagmati" },
  dimensions: { heightMm: 640, widthMm: 480 },
  materials: ["Cotton canvas", "Mineral pigments"],
  technique: "Hand painted",
  publicContent: {
    story: "A story about the work.",
    meaning: "Its artistic meaning.",
    culturalContext: "The tradition around the work.",
    creationProcess: "How the artist made it.",
  },
});

describe("canonical document bytes", () => {
  it("sorts nested object keys independently of insertion order", () => {
    const first = { z: { b: 2, a: 1 }, a: "पौभा" };
    const second = { a: "पौभा", z: { a: 1, b: 2 } };
    expect(canonicalDocumentBytes(first)).toEqual(canonicalDocumentBytes(second));
    expect(text(first)).toBe('{"a":"पौभा","z":{"a":1,"b":2}}');
  });

  it("sorts numeric-looking keys lexically rather than by JavaScript object enumeration", () => {
    expect(text({ "2": 2, "10": 10 })).toBe('{"10":10,"2":2}');
  });

  it("preserves array order while sorting objects inside arrays", () => {
    const first = {
      media: [
        { role: "front", hash: "a" },
        { role: "back", hash: "b" },
      ],
    };
    const reorderedKeys = {
      media: [
        { hash: "a", role: "front" },
        { hash: "b", role: "back" },
      ],
    };
    const reorderedMedia = {
      media: [
        { hash: "b", role: "back" },
        { hash: "a", role: "front" },
      ],
    };
    expect(canonicalDocumentBytes(first)).toEqual(
      canonicalDocumentBytes(reorderedKeys),
    );
    expect(canonicalDocumentBytes(first)).not.toEqual(
      canonicalDocumentBytes(reorderedMedia),
    );
  });

  it("uses UTF-8 bytes with no BOM or trailing newline", () => {
    expect(canonicalDocumentBytes({ title: "पौभा" })).toEqual(
      new TextEncoder().encode('{"title":"पौभा"}'),
    );
  });

  it("accepts shared references without treating them as cycles", () => {
    const value = { key: "value" };
    expect(text({ left: value, right: value })).toBe(
      '{"left":{"key":"value"},"right":{"key":"value"}}',
    );
  });

  it.each([
    undefined,
    NaN,
    Infinity,
    9007199254740992,
    1n,
    new Date("2025-01-01T00:00:00.000Z"),
    new Map(),
    { field: undefined },
    { field: () => "hidden" },
    { field: "\ud800" },
    { "\udc00": "value" },
    Object.assign(new Array<string>(2), { 1: "second" }),
  ])("rejects non-JSON or lossy input %#", (value) => {
    expect(() => canonicalDocumentBytes(value)).toThrow(TypeError);
  });

  it("rejects cycles, accessors, hidden fields, and symbol fields", () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const accessor = Object.defineProperty({}, "private", {
      get: () => "secret",
      enumerable: true,
    });
    const hidden = Object.defineProperty({}, "private", { value: "secret" });
    const symbol = { [Symbol("private")]: "secret" };
    for (const value of [cycle, accessor, hidden, symbol]) {
      expect(() => canonicalDocumentBytes(value)).toThrow(TypeError);
    }
  });
});

describe("SHA-256 integrity", () => {
  it("hashes the exact published byte sequence", async () => {
    const bytes = canonicalDocumentBytes({ b: 2, a: 1 });
    expect(text({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(await sha256Hex(bytes)).toBe(
      "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
    );
  });

  it("detects changed content and reordered media", async () => {
    const original = canonicalDocumentBytes({
      title: "Lotus",
      media: ["front", "back"],
    });
    const changedTitle = canonicalDocumentBytes({
      title: "Lotus II",
      media: ["front", "back"],
    });
    const reorderedMedia = canonicalDocumentBytes({
      title: "Lotus",
      media: ["back", "front"],
    });
    const originalHash = await sha256Hex(original);
    expect(await sha256Hex(changedTitle)).not.toBe(originalHash);
    expect(await sha256Hex(reorderedMedia)).not.toBe(originalHash);
    original[0] ^= 1;
    expect(await sha256Hex(original)).not.toBe(originalHash);
  });

  it("keeps public artwork and private inspection documents separate", async () => {
    const publicArtwork = artworkSchema.parse(artwork());
    const publicHash = await sha256Hex(canonicalDocumentBytes(publicArtwork));
    expect(
      artworkSchema.safeParse({ ...artwork(), shippingAddress: "private" }).success,
    ).toBe(false);

    const report = conditionReportDocumentSchema.parse({
      reportId: "5e3db4cb-19b2-4a50-9aeb-107a439b51ca",
      kathaId: publicArtwork.kathaId,
      grade: "GOOD",
      reason: "INITIAL_VERIFICATION",
      inspectorId: "4740ea06-7cfa-4d6a-b20a-c7ddc848f677",
      verifierWallet: "11111111111111111111111111111111",
      inspectedAt: "2025-06-15T09:30:00.000Z",
      reportedAt: "2025-06-15T10:00:00.000Z",
      notes: "Private inspection detail.",
      mediaHashes: ["b".repeat(64)],
    });
    expect(
      artworkSchema.safeParse({ ...publicArtwork, conditionReport: report }).success,
    ).toBe(false);
    expect(await sha256Hex(canonicalDocumentBytes(publicArtwork))).toBe(publicHash);
    expect(await sha256Hex(canonicalDocumentBytes(report))).not.toBe(publicHash);
  });
});
