import { expect, it, vi } from "vitest";
import {
  address,
  type Rpc,
  type GetAccountInfoApi,
  type GetMultipleAccountsApi,
  type GetGenesisHashApi,
} from "@solana/kit";
import {
  marketplaceTransactionFixture,
  snapshot,
} from "./fixtures/marketplace-transactions.js";
import { readMarketplaceListingState } from "../src/marketplace.js";
import { createMarketplaceListingReaderFromRpc } from "../src/marketplace-listing-reader.js";
import * as market from "../src/generated/marketplace/index.js";
const mocked = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@solana/kit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@solana/kit")>()),
  fetchEncodedAccount: mocked.fetch,
}));
async function fixture() {
  const f = await marketplaceTransactionFixture();
  mocked.fetch.mockResolvedValue(f.accounts.registryConfigAccount);
  const clock = new Uint8Array(40);
  new DataView(clock.buffer).setBigInt64(32, f.context.chainTime, true);
  const encoded = (a: typeof f.accounts.assetAccount) => ({
    data: [Buffer.from(a.data).toString("base64"), "base64"],
    executable: a.executable,
    owner: a.programAddress,
    lamports: a.lamports,
    space: a.space,
    rentEpoch: 0n,
  });
  const values: unknown[] = [
    f.accounts.marketplaceConfigAccount,
    f.accounts.registryConfigAccount,
    f.accounts.artworkAccount,
    f.accounts.assetAccount,
    f.accounts.collectionAccount,
    f.accounts.listingAccount,
    f.accounts.conditionHeadAccount,
    snapshot(
      address("SysvarC1ock11111111111111111111111111111111"),
      address("Sysvar1111111111111111111111111111111111111"),
      clock,
    ),
  ].map((a) => encoded(a as typeof f.accounts.assetAccount));
  const getMultipleAccounts = vi.fn(() => ({
    send: async () => ({ context: { slot: 9007199254740993n }, value: values }),
  }));
  const getGenesisHash = vi.fn(() => ({
    send: async () => "11111111111111111111111111111111",
  }));
  const read = createMarketplaceListingReaderFromRpc(
    { getMultipleAccounts, getGenesisHash } as unknown as Rpc<
      GetAccountInfoApi & GetMultipleAccountsApi & GetGenesisHashApi
    >,
    "localnet",
  );
  return { ...f, values, read, getMultipleAccounts, getGenesisHash };
}
it("uses one finalized account/Clock snapshot and retains exact slots and owner", async () => {
  const f = await fixture();
  const result = await f.read(f.kathaId);
  expect(result.observedSlot).toBe(9007199254740993n);
  expect(result.chainTime).toBe(f.context.chainTime);
  expect(result.state).toMatchObject({
    owner: f.seller,
    active: true,
    revision: 1n,
    asset: f.asset,
  });
  expect(f.getMultipleAccounts.mock.calls[0]).toMatchObject([
    expect.any(Array),
    { commitment: "finalized", encoding: "base64" },
  ]);
});
it("supports unlisted artwork and reports expired active records without inventing a cancellation", async () => {
  const f = await fixture();
  f.values[5] = null;
  expect((await f.read(f.kathaId)).state).toMatchObject({
    ledger: null,
    revision: 0n,
    active: false,
  });
  const state = await readMarketplaceListingState(
    f.accounts,
    f.kathaId,
    BigInt(f.ledger.expiresAt),
  );
  expect(state.active).toBe(false);
  expect(state.ledger?.status).toBe(market.ListingStatus.Active);
});
it.each([
  "owner",
  "clock-owner",
  "clock-size",
  "missing-core",
  "genesis",
  "malformed-ledger",
  "condition-owner",
])("rejects forged or incomplete snapshot: %s", async (reason) => {
  const f = await fixture();
  if (reason === "owner") f.values[0] = { ...(f.values[0] as object), owner: f.buyer };
  if (reason === "clock-owner")
    f.values[7] = { ...(f.values[7] as object), owner: f.seller };
  if (reason === "clock-size")
    f.values[7] = { ...(f.values[7] as object), data: ["AA==", "base64"] };
  if (reason === "missing-core") f.values[3] = null;
  if (reason === "genesis")
    f.getGenesisHash.mockImplementation(() => ({
      send: async () => "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    }));
  if (reason === "malformed-ledger")
    f.values[5] = { ...(f.values[5] as object), data: ["AA==", "base64"] };
  if (reason === "condition-owner")
    f.values[6] = { ...(f.values[6] as object), owner: f.buyer };
  await expect(f.read(f.kathaId)).rejects.toThrow();
});
it("rejects nonsensical ledger state and accepts maximum revision for read-only recovery", async () => {
  const f = await fixture();
  const update = (changes: Partial<market.ListingRecordArgs>) => {
    f.accounts.listingAccount = snapshot(
      f.listing,
      market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
      Uint8Array.from(
        market.getListingRecordEncoder().encode({ ...f.ledger, ...changes }),
      ),
    );
  };
  update({ price: 0n });
  await expect(
    readMarketplaceListingState(f.accounts, f.kathaId, f.context.chainTime),
  ).rejects.toThrow();
  update({ revision: 18446744073709551615n });
  expect(
    (await readMarketplaceListingState(f.accounts, f.kathaId, f.context.chainTime))
      .revision,
  ).toBe(18446744073709551615n);
});
