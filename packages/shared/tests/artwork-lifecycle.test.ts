import { describe, expect, it } from "vitest";

import {
  artworkVerificationStateSchema,
  artworkVerificationTransitionSchema,
  physicalCustodyStateSchema,
  physicalCustodyTransitionSchema,
  artworkRegistrationStateSchema,
  artworkRegistrationTransitionSchema,
} from "../src/artwork-lifecycle.js";

const validCustodyTransitions = [
  { action: "ATTEST_KATHA_CUSTODY", from: "UNKNOWN", to: "KATHA_HELD" },
  { action: "ATTEST_COLLECTOR_CUSTODY", from: "UNKNOWN", to: "COLLECTOR_HELD" },
  { action: "DISPATCH_FROM_KATHA", from: "KATHA_HELD", to: "IN_TRANSIT" },
  { action: "DISPATCH_FROM_COLLECTOR", from: "COLLECTOR_HELD", to: "IN_TRANSIT" },
  { action: "RECEIVE_AT_KATHA", from: "IN_TRANSIT", to: "KATHA_HELD" },
  { action: "RECEIVE_BY_COLLECTOR", from: "IN_TRANSIT", to: "COLLECTOR_HELD" },
];

describe("independent lifecycle dimensions", () => {
  it("keeps registration separate from authentication and custody", () => {
    expect(artworkRegistrationStateSchema.parse("REGISTERED")).toBe("REGISTERED");
    expect(artworkVerificationStateSchema.parse("UNVERIFIED")).toBe("UNVERIFIED");
    expect(physicalCustodyStateSchema.parse("UNKNOWN")).toBe("UNKNOWN");
  });

  it.each(["VERIFIED", "KATHA_HELD", "LISTED", "RESALE_APPROVED"])(
    "rejects %s as a registration state",
    (state) => {
      expect(artworkRegistrationStateSchema.safeParse(state).success).toBe(false);
    },
  );

  it.each(["REGISTERED", "IN_TRANSIT", "LISTED", "RESALE_APPROVED"])(
    "rejects %s as an authentication state",
    (state) => {
      expect(artworkVerificationStateSchema.safeParse(state).success).toBe(false);
    },
  );

  it.each(["REGISTERED", "VERIFIED", "LISTED", "RESALE_APPROVED"])(
    "rejects %s as a physical custody state",
    (state) => {
      expect(physicalCustodyStateSchema.safeParse(state).success).toBe(false);
    },
  );
});

describe("named registration and authentication transitions", () => {
  it("accepts registration followed by authentication", () => {
    expect(
      artworkRegistrationTransitionSchema.safeParse({
        action: "REGISTER",
        from: "DRAFT",
        to: "REGISTERED",
      }).success,
    ).toBe(true);
    expect(
      artworkVerificationTransitionSchema.safeParse({
        action: "VERIFY_ARTWORK",
        registration: "REGISTERED",
        from: "UNVERIFIED",
        to: "VERIFIED",
      }).success,
    ).toBe(true);
  });

  it("rejects authentication before registration and reverse transitions", () => {
    expect(
      artworkVerificationTransitionSchema.safeParse({
        action: "VERIFY_ARTWORK",
        registration: "DRAFT",
        from: "UNVERIFIED",
        to: "VERIFIED",
      }).success,
    ).toBe(false);
    expect(
      artworkRegistrationTransitionSchema.safeParse({
        action: "REGISTER",
        from: "REGISTERED",
        to: "DRAFT",
      }).success,
    ).toBe(false);
    expect(
      artworkVerificationTransitionSchema.safeParse({
        action: "VERIFY_ARTWORK",
        registration: "REGISTERED",
        from: "VERIFIED",
        to: "UNVERIFIED",
      }).success,
    ).toBe(false);
  });
});

describe("physical custody transitions", () => {
  it.each(validCustodyTransitions)("accepts $action", (transition) => {
    expect(physicalCustodyTransitionSchema.safeParse(transition).success).toBe(true);
  });

  it.each([
    { action: "DISPATCH_FROM_KATHA", from: "COLLECTOR_HELD", to: "IN_TRANSIT" },
    { action: "RECEIVE_BY_COLLECTOR", from: "KATHA_HELD", to: "COLLECTOR_HELD" },
    { action: "ATTEST_KATHA_CUSTODY", from: "UNKNOWN", to: "COLLECTOR_HELD" },
    { action: "RECEIVE_AT_KATHA", from: "IN_TRANSIT", to: "IN_TRANSIT" },
    { action: "LIST", from: "KATHA_HELD", to: "IN_TRANSIT" },
    {
      action: "DISPATCH_FROM_KATHA",
      from: "KATHA_HELD",
      to: "IN_TRANSIT",
      verified: true,
    },
  ])("rejects invalid or mixed transition %#", (transition) => {
    expect(physicalCustodyTransitionSchema.safeParse(transition).success).toBe(false);
  });
});
