import { expect, it, vi } from "vitest";
import { SolanaError, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR } from "@solana/kit";
import type {
  Rpc,
  GetGenesisHashApi,
  GetSignaturesForAddressApi,
  GetTransactionApi,
  GetBlockApi,
} from "@solana/kit";
import { createActivityReaderFromRpc } from "../src/activity-reader.js";
import { KATHA_REGISTRY_PROGRAM_ADDRESS } from "../src/generated/registry/index.js";
import { CORE_PROGRAM_ADDRESS } from "../src/core.js";
import {
  activityFixture,
  base58,
  COLLECTION,
  SIG,
  OTHER_SIG,
  SLOT,
  SYSTEM,
} from "./fixtures/activity.js";
const OTHER = "SysvarRent111111111111111111111111111111111";
function fixture() {
  const response = activityFixture();
  const rows = [
    {
      signature: SIG,
      slot: SLOT,
      confirmationStatus: "finalized",
      err: null as unknown,
    },
  ];
  const genesis = vi.fn(async () => SYSTEM);
  const listing = vi.fn(async () => rows);
  const transaction = vi.fn(async (): Promise<unknown> => response);
  const block = vi.fn(async (): Promise<unknown> => ({ signatures: [OTHER_SIG, SIG] }));
  const rpc = {
    getGenesisHash: vi.fn(() => ({ send: genesis })),
    getSignaturesForAddress: vi.fn(() => ({ send: listing })),
    getTransaction: vi.fn(() => ({ send: transaction })),
    getBlock: vi.fn(() => ({ send: block })),
  } as unknown as Rpc<
    GetGenesisHashApi & GetSignaturesForAddressApi & GetTransactionApi & GetBlockApi
  >;
  return {
    response,
    rows,
    genesis,
    listing,
    transaction,
    block,
    rpc,
    read: createActivityReaderFromRpc(rpc, "localnet"),
  };
}
it("reads finalized exact evidence and real block position with bounded pagination", async () => {
  const f = fixture();
  const page = await f.read({
    programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS,
    before: OTHER_SIG,
    limit: 1,
  });
  expect(page).toMatchObject({
    headSignature: SIG,
    nextBefore: SIG,
    transactions: [
      { signature: SIG, slot: SLOT, transactionIndex: 1, outcome: "SUCCESS" },
    ],
  });
  expect(f.rpc.getSignaturesForAddress).toHaveBeenCalledWith(
    KATHA_REGISTRY_PROGRAM_ADDRESS,
    { commitment: "finalized", before: OTHER_SIG, limit: 1 },
  );
  expect(f.rpc.getTransaction).toHaveBeenCalledWith(SIG, {
    commitment: "finalized",
    encoding: "json",
    maxSupportedTransactionVersion: 1,
  });
  expect(f.rpc.getBlock).toHaveBeenCalledWith(SLOT, {
    commitment: "finalized",
    transactionDetails: "signatures",
    maxSupportedTransactionVersion: 1,
    rewards: false,
  });
});
it("returns an empty page without pretending it contains a scanned slot range", async () => {
  const f = fixture();
  f.rows.length = 0;
  expect(
    await f.read({ programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS }),
  ).toMatchObject({ headSignature: null, nextBefore: null, transactions: [] });
  expect(f.transaction).not.toHaveBeenCalled();
  expect(f.block).not.toHaveBeenCalled();
});
it("retries a rate-limited block read without restarting successful page reads", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    f.block.mockRejectedValueOnce(
      new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
        statusCode: 429,
        message: "Synthetic rate limit",
        headers: new Headers({ "retry-after": "2" }),
      }),
    );
    const page = f.read({ programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS });
    await vi.advanceTimersByTimeAsync(2000);
    expect((await page).transactions[0]).toMatchObject({
      signature: SIG,
      transactionIndex: 1,
    });
    expect(f.genesis).toHaveBeenCalledTimes(1);
    expect(f.listing).toHaveBeenCalledTimes(1);
    expect(f.transaction).toHaveBeenCalledTimes(1);
    expect(f.block).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
it("caches block signatures within the page and sorts equal-slot transactions by block order", async () => {
  const f = fixture();
  f.rows.push({ ...f.rows[0]!, signature: OTHER_SIG });
  let count = 0;
  f.transaction.mockImplementation(async () => {
    const response = structuredClone(f.response);
    response.transaction.signatures[0] = count++ === 0 ? SIG : OTHER_SIG;
    return response;
  });
  const page = await f.read({ programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS });
  expect(page.transactions.map((t) => t.signature)).toEqual([OTHER_SIG, SIG]);
  expect(f.block).toHaveBeenCalledTimes(1);
});
it("includes failed scan positions with no decoded successful activities", async () => {
  const f = fixture();
  f.rows[0]!.err = { InstructionError: [0, "Synthetic"] };
  f.response.meta.err = f.rows[0]!.err;
  expect(
    (await f.read({ programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS })).transactions[0],
  ).toMatchObject({ outcome: "FAILED", activities: [], transactionIndex: 1 });
});
it("accepts the selected Devnet genesis before reading", async () => {
  const f = fixture();
  f.genesis.mockResolvedValue(
    "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" as typeof SYSTEM,
  );
  const read = createActivityReaderFromRpc(f.rpc, "devnet");
  expect((await read({ programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS })).cluster).toBe(
    "devnet",
  );
});
it.each([
  "wrong genesis",
  "missing transaction",
  "unfinalized listing",
  "slot mismatch",
  "signature mismatch",
  "duplicate listing",
  "wrong block",
  "missing block",
  "wrong source program",
  "failure mismatch",
  "listing timeout",
  "transaction timeout",
  "repeated cursor",
])("does not acknowledge a page with %s", async (reason) => {
  const f = fixture();
  switch (reason) {
    case "wrong genesis":
      f.genesis.mockResolvedValue(
        "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" as typeof SYSTEM,
      );
      break;
    case "missing transaction":
      f.transaction.mockResolvedValue(null);
      break;
    case "unfinalized listing":
      f.rows[0]!.confirmationStatus = "confirmed";
      break;
    case "slot mismatch":
      f.response.slot++;
      break;
    case "signature mismatch":
      f.response.transaction.signatures[0] = OTHER_SIG;
      break;
    case "duplicate listing":
      f.rows.push({ ...f.rows[0]! });
      break;
    case "wrong block":
      f.block.mockResolvedValue({ signatures: [OTHER_SIG] });
      break;
    case "missing block":
      f.block.mockResolvedValue(null);
      break;
    case "wrong source program":
      f.transaction.mockResolvedValue(activityFixture(CORE_PROGRAM_ADDRESS));
      break;
    case "failure mismatch":
      f.response.meta.err = { InstructionError: [0, "Synthetic"] };
      break;
    case "listing timeout":
      f.listing.mockRejectedValue(new Error("synthetic RPC secret"));
      break;
    case "transaction timeout":
      f.transaction.mockRejectedValue(new Error("synthetic RPC secret"));
      break;
    case "repeated cursor":
      break;
  }
  // A Core transaction may still mention Registry; remove the discovery key too.
  if (reason === "wrong source program") {
    const response = activityFixture(CORE_PROGRAM_ADDRESS);
    response.transaction.message.accountKeys[0] = SYSTEM;
    f.transaction.mockResolvedValue(response);
  }
  await expect(
    f.read({
      programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS,
      ...(reason === "repeated cursor" ? { before: SIG } : {}),
    }),
  ).rejects.toThrow();
});
it.each([0, 101, 1.5])("rejects invalid page size %s before RPC", async (limit) => {
  const f = fixture();
  await expect(
    f.read({ programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS, limit }),
  ).rejects.toThrow();
  expect(f.genesis).not.toHaveBeenCalled();
});
it("rejects other watched programs before RPC", async () => {
  const f = fixture();
  await expect(f.read({ programAddress: SYSTEM })).rejects.toThrow();
  expect(f.genesis).not.toHaveBeenCalled();
});
it("discovers Core activity through the collection without scanning the Core program", async () => {
  const f = fixture();
  f.transaction.mockResolvedValue(activityFixture(CORE_PROGRAM_ADDRESS));
  const page = await f.read({
    programAddress: CORE_PROGRAM_ADDRESS,
    discoveryAddress: COLLECTION,
  });
  expect(f.rpc.getSignaturesForAddress).toHaveBeenCalledWith(COLLECTION, {
    commitment: "finalized",
    limit: 25,
  });
  expect(page.programAddress).toBe(CORE_PROGRAM_ADDRESS);
  expect(page.transactions[0]!.activities.map((a) => a.kind)).toEqual([
    "CORE_TRANSFER",
  ]);
});
it("keeps a collection reference that never invokes Core as an empty scan position", async () => {
  const f = fixture();
  const response = activityFixture(CORE_PROGRAM_ADDRESS);
  // Anyone may send lamports to the collection; that must not stall Core ingestion.
  response.transaction.message.accountKeys[1] = OTHER;
  response.transaction.message.instructions = [
    {
      programIdIndex: 2,
      accounts: [4, 5],
      data: base58([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]),
      stackHeight: 1,
    },
  ];
  response.meta.logMessages = [
    `Program ${SYSTEM} invoke [1]`,
    `Program ${SYSTEM} success`,
  ];
  f.transaction.mockResolvedValue(response);
  const page = await f.read({
    programAddress: CORE_PROGRAM_ADDRESS,
    discoveryAddress: COLLECTION,
  });
  expect(page.headSignature).toBe(SIG);
  expect(page.transactions).toMatchObject([{ signature: SIG, activities: [] }]);
  // Without a narrower discovery account, Core history still requires the Core key.
  await expect(f.read({ programAddress: CORE_PROGRAM_ADDRESS })).rejects.toThrow();
});
it.each([
  ["a non-Core stream", KATHA_REGISTRY_PROGRAM_ADDRESS, COLLECTION],
  [
    "a watched program as discovery",
    CORE_PROGRAM_ADDRESS,
    KATHA_REGISTRY_PROGRAM_ADDRESS,
  ],
  ["an invalid address", CORE_PROGRAM_ADDRESS, "not-an-address"],
] as const)(
  "rejects discovery through %s before RPC",
  async (_, programAddress, discoveryAddress) => {
    const f = fixture();
    await expect(f.read({ programAddress, discoveryAddress })).rejects.toThrow();
    expect(f.genesis).not.toHaveBeenCalled();
  },
);
