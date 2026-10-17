import { describe, expect, it } from "vitest";
import { governanceSetupSchema } from "../src/governance.js";

const keys = [
  "Vote111111111111111111111111111111111111111",
  "Stake11111111111111111111111111111111111111",
  "Config1111111111111111111111111111111111111",
  "AddressLookupTab1e1111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "BPFLoaderUpgradeab1e11111111111111111111111",
];
const setup = () => ({
  cluster: "devnet",
  multisig: keys[0],
  members: keys.slice(1, 4),
  vaultIndex: 0,
  timeLockSeconds: 0,
  grants: [
    {
      wallet: keys[4],
      roles: ["catalog", "registrar", "inventorySales"],
      expiresAt: "0",
    },
    { wallet: keys[5], roles: ["artistVerifier", "artworkVerifier"], expiresAt: "0" },
    { wallet: keys[6], roles: ["custody"], expiresAt: "0" },
  ],
});
describe("public governance setup", () => {
  it("accepts separate governance and complete operational roles", () =>
    expect(governanceSetupSchema.safeParse(setup()).success).toBe(true));
  it.each(["network", "member", "role", "expiry", "separation", "unknown"])(
    "rejects invalid %s",
    (change) => {
      const input = setup();
      if (change === "network") input.cluster = "mainnet";
      if (change === "member") input.members[1] = input.members[0]!;
      if (change === "role") input.grants[0]!.roles = ["catalog"];
      if (change === "expiry") input.grants[0]!.expiresAt = "9223372036854775808";
      if (change === "separation") input.grants[0]!.wallet = input.members[0];
      expect(
        governanceSetupSchema.safeParse(
          change === "unknown" ? { ...input, privateKey: "forbidden" } : input,
        ).success,
      ).toBe(false);
    },
  );
});
