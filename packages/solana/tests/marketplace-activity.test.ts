import { expect, it } from "vitest";
import { decodeFinalizedActivity } from "../src/chain-activity.js";
import { decodeMarketplaceEvent } from "../src/marketplace-events.js";
import * as m from "../src/generated/marketplace/index.js";
import { CORE_PROGRAM_ADDRESS } from "../src/core.js";
import {
  activityFixture,
  base58,
  SIG,
  SLOT,
  SYSTEM,
  ARTWORK,
  OWNER,
  COLLECTION,
} from "./fixtures/activity.js";
function purchase() {
  const f = activityFixture();
  f.transaction.message.accountKeys.push(m.KATHA_MARKETPLACE_PROGRAM_ADDRESS);
  const accounts = Array<number>(22).fill(2);
  accounts[3] = 3;
  accounts[9] = 3;
  accounts[10] = 2;
  accounts[11] = 2;
  accounts[12] = 5;
  accounts[14] = 4;
  accounts[15] = 5;
  f.transaction.message.instructions = [
    {
      programIdIndex: 6,
      accounts,
      data: base58(
        m
          .getPurchaseListingInstructionDataEncoder()
          .encode({ expectedRevision: 1n, expectedPrice: 100n }),
      ),
      stackHeight: 1,
    },
  ];
  f.meta.innerInstructions = [
    {
      index: 0,
      instructions: [
        {
          programIdIndex: 1,
          accounts: [3, 5, 2, 2, 4],
          data: base58([14, 0]),
          stackHeight: 2,
        },
      ],
    },
  ];
  const bytes = m.getArtworkPurchasedEventEncoder().encode({
    listing: SYSTEM,
    artwork: ARTWORK,
    asset: ARTWORK,
    seller: SYSTEM,
    buyer: OWNER,
    artistPayout: SYSTEM,
    treasury: SYSTEM,
    paymentMint: COLLECTION,
    price: 100n,
    sellerProceeds: 0n,
    artistProceeds: 98n,
    treasuryFee: 2n,
    saleKind: m.SaleKind.Primary,
    revision: 2n,
    completedSales: 1n,
    conditionReport: ARTWORK,
    conditionHash: new Uint8Array(32).fill(1),
    conditionVersion: 1,
    custodyRevision: 1n,
    purchasedAt: 1n,
  });
  f.meta.logMessages = [
    `Program ${m.KATHA_MARKETPLACE_PROGRAM_ADDRESS} invoke [1]`,
    `Program ${CORE_PROGRAM_ADDRESS} invoke [2]`,
    `Program ${CORE_PROGRAM_ADDRESS} success`,
    `Program data: ${Buffer.from(bytes).toString("base64")}`,
    `Program ${m.KATHA_MARKETPLACE_PROGRAM_ADDRESS} success`,
  ];
  return f;
}
it("correlates finalized purchase events with successful Core CPI transfers", () => {
  const tx = decodeFinalizedActivity(purchase(), SIG, SLOT);
  expect(tx.activities.map((a) => a.kind)).toEqual(["CORE_TRANSFER", "MARKETPLACE"]);
  expect(tx.activities[1]).toMatchObject({
    event: { name: "ArtworkPurchased", value: { price: 100n, treasuryFee: 2n } },
  });
});
it.each([
  "missing transfer",
  "wrong buyer",
  "wrong delegate",
  "wrong collection",
  "wrong price",
  "missing event",
  "duplicate event",
  "spoofed log",
  "truncated log",
])("rejects %s purchase evidence", (kind) => {
  const f = purchase();
  const inner = f.meta.innerInstructions[0]!.instructions[0]!;
  if (kind === "missing transfer") {
    f.meta.innerInstructions = [];
    f.meta.logMessages.splice(1, 2);
  }
  if (kind === "wrong buyer") inner.accounts[4] = 2;
  if (kind === "wrong delegate") inner.accounts[3] = 4;
  if (kind === "wrong collection") inner.accounts[1] = 2;
  if (kind === "wrong price")
    f.transaction.message.instructions[0]!.data = base58(
      m
        .getPurchaseListingInstructionDataEncoder()
        .encode({ expectedRevision: 1n, expectedPrice: 101n }),
    );
  if (kind === "missing event") f.meta.logMessages.splice(3, 1);
  if (kind === "duplicate event")
    f.meta.logMessages.splice(4, 0, f.meta.logMessages[3]!);
  if (kind === "spoofed log")
    f.meta.logMessages[3] = `Program log: ${f.meta.logMessages[3]}`;
  if (kind === "truncated log") f.meta.logMessages[3] = "Log truncated";
  expect(() => decodeFinalizedActivity(f, SIG, SLOT)).toThrow();
});
it("ignores all events in failed purchases", () => {
  const f = purchase();
  f.meta.err = { InstructionError: [0, "Custom"] };
  expect(decodeFinalizedActivity(f, SIG, SLOT).activities).toEqual([]);
});
it("rejects unknown and noncanonical Marketplace event bytes", () => {
  expect(() => decodeMarketplaceEvent(new Uint8Array(8))).toThrow();
  const encoded = purchase().meta.logMessages[3]!.slice(14);
  expect(() =>
    decodeMarketplaceEvent(
      Buffer.concat([Buffer.from(encoded, "base64"), Buffer.from([0])]),
    ),
  ).toThrow();
});

it("decodes listing creation and both release instructions with bound revisions", () => {
  const created = {
    listing: SYSTEM,
    artwork: ARTWORK,
    asset: ARTWORK,
    seller: SYSTEM,
    artistPayout: OWNER,
    paymentMint: COLLECTION,
    price: 100n,
    revision: 1n,
    saleKind: m.SaleKind.Primary,
    conditionReport: ARTWORK,
    conditionHash: new Uint8Array(32).fill(1),
    conditionVersion: 1,
    custodyRevision: 1n,
    createdAt: 1n,
    expiresAt: 100n,
  };
  for (const kind of ["create", "cancel", "expire"] as const) {
    const f = purchase(),
      instruction = f.transaction.message.instructions[0]!;
    f.meta.innerInstructions = [];
    let eventData: ArrayLike<number>;
    if (kind === "create") {
      instruction.accounts = instruction.accounts.slice(0, 15);
      instruction.data = base58(
        m
          .getCreateListingInstructionDataEncoder()
          .encode({ price: 100n, expiresAt: 100n, expectedRevision: 0n }),
      );
      eventData = m.getListingCreatedEventEncoder().encode(created);
    } else {
      instruction.accounts = Array<number>(10).fill(2);
      instruction.accounts[3] = 3;
      instruction.accounts[4] = 3;
      instruction.accounts[6] = 4;
      instruction.accounts[7] = 5;
      instruction.data = base58(
        (kind === "cancel"
          ? m.getCancelListingInstructionDataEncoder()
          : m.getExpireListingInstructionDataEncoder()
        ).encode({ expectedRevision: 1n }),
      );
      eventData = m.getListingReleasedEventEncoder().encode({
        listing: SYSTEM,
        artwork: ARTWORK,
        asset: ARTWORK,
        seller: SYSTEM,
        actor: OWNER,
        revision: 2n,
        status: kind === "cancel" ? m.ListingStatus.Cancelled : m.ListingStatus.Expired,
        releasedAt: 1n,
      });
    }
    f.meta.logMessages = [
      `Program ${m.KATHA_MARKETPLACE_PROGRAM_ADDRESS} invoke [1]`,
      `Program data: ${Buffer.from(eventData).toString("base64")}`,
      `Program ${m.KATHA_MARKETPLACE_PROGRAM_ADDRESS} success`,
    ];
    expect(decodeFinalizedActivity(f, SIG, SLOT).activities).toHaveLength(1);
    instruction.accounts[3] = 4;
    expect(() => decodeFinalizedActivity(f, SIG, SLOT)).toThrow();
  }
});
it("binds Marketplace initialization to the generated account positions", () => {
  const f = purchase(),
    instruction = f.transaction.message.instructions[0]!;
  instruction.accounts = [2, 2, 6, 3, 0, 3, 4, 5, 3, 2];
  instruction.data = base58(
    m.getInitializeMarketplaceInstructionDataEncoder().encode({
      commissionBps: 250,
      secondaryRoyaltyBps: 500,
      inspectionValiditySeconds: 2592000n,
    }),
  );
  const value = {
    config: SYSTEM,
    authority: OWNER,
    registryProgram: f.transaction.message.accountKeys[0]!,
    registryConfig: ARTWORK,
    collection: COLLECTION,
    treasury: OWNER,
    paymentMint: COLLECTION,
    tokenProgram: ARTWORK,
    paymentDecimals: 6,
    commissionBps: 250,
    secondaryRoyaltyBps: 500,
    inspectionValiditySeconds: 2592000n,
  };
  const data = m
    .getMarketplaceInitializedEventEncoder()
    .encode({ ...value, registryProgram: ARTWORK });
  // ARTWORK is not the Registry program account at position 4.
  f.meta.innerInstructions = [];
  const logs = (data: ArrayLike<number>) => [
    `Program ${m.KATHA_MARKETPLACE_PROGRAM_ADDRESS} invoke [1]`,
    `Program data: ${Buffer.from(data).toString("base64")}`,
    `Program ${m.KATHA_MARKETPLACE_PROGRAM_ADDRESS} success`,
  ];
  f.meta.logMessages = logs(data);
  expect(() => decodeFinalizedActivity(f, SIG, SLOT)).toThrow();
  instruction.accounts[4] = 3;
  expect(decodeFinalizedActivity(f, SIG, SLOT).activities[0]).toMatchObject({
    event: { name: "MarketplaceInitialized" },
  });
});
