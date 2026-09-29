import { describe, expect, it } from "vitest";

import { artworkCategorySchema, kathaIdSchema } from "../src/artwork-identity.js";

describe("artwork categories", () => {
  it.each(["MANDALA", "PAUBHA", "THANGKA"])("accepts %s", (category) => {
    expect(artworkCategorySchema.parse(category)).toBe(category);
  });

  it.each(["TEXTILE", "mandala", "", 0, null])("rejects %s", (category) => {
    expect(artworkCategorySchema.safeParse(category).success).toBe(false);
  });
});

describe("permanent Katha IDs", () => {
  it.each(["KATHA-MANDALA-000001", "KATHA-PAUBHA-000001", "KATHA-THANGKA-999999"])(
    "accepts %s",
    (id) => {
      expect(kathaIdSchema.parse(id)).toBe(id);
    },
  );

  it.each([
    "KATHA-PAUBHA-000000",
    "KATHA-PAUBHA-1000000",
    "KATHA-PAUBHA-1",
    "KATHA-TEXTILE-000001",
    "katha-PAUBHA-000001",
    "KATHA-paubha-000001",
    "KATHA-PAUBHA-000001 ",
    "KATHA-PAUBHA-０００００１",
    "KATHA-PAUBHA-000001/extra",
    "",
    123,
  ])("rejects malformed ID %s", (id) => {
    expect(kathaIdSchema.safeParse(id).success).toBe(false);
  });
});
