import assert from "node:assert/strict";
import { test } from "node:test";
import { createCollectorDelivery } from "../lib/collector-delivery.ts";
import { createWalletSessionApi } from "../lib/wallet-session-api.ts";
import type {
  CollectorDeliveryReview,
  FulfillmentCreateRequest,
  FulfillmentResponse,
} from "@katha/shared";
import type { WalletSessionSnapshot } from "../lib/wallet-session.ts";
const kathaId = "KATHA-PAUBHA-000001";
const session = {
  walletId: "aaaaaaaa-1111-4111-8111-111111111111",
  walletAddress: "11111111111111111111111111111112",
  cluster: "localnet" as const,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
};
const initial: CollectorDeliveryReview = {
  kathaId,
  title: "Synthetic artwork",
  cluster: "localnet",
  ownerWallet: session.walletAddress,
  custodyState: "KATHA_HELD",
  custodyRevision: "1",
  canRequest: true,
  requests: [],
  pagination: { limit: 20, offset: 0, hasMore: false },
};
function fixture() {
  let auth: WalletSessionSnapshot = { status: "signed-in", session, error: null };
  let page = structuredClone(initial),
    writes = 0,
    reports = 0;
  const cancels: string[] = [];
  const listeners = new Set<() => void>();
  const methods = {
    getSnapshot: () => auth,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async readDelivery() {
      return page;
    },
    async createDelivery(_id: string, input: FulfillmentCreateRequest) {
      writes++;
      const now = new Date().toISOString();
      const { requestId, ...fields } = input;
      const row: FulfillmentResponse = {
        ...fields,
        id: requestId,
        kathaId,
        status: "REQUESTED",
        courier: null,
        trackingReference: null,
        ownerReportedReceivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      page = { ...page, canRequest: false, requests: [row] };
      return row;
    },
    async cancelDelivery(id: string) {
      cancels.push(id);
      const row = {
        ...page.requests.find((item) => item.id === id)!,
        status: "CANCELLED" as const,
      };
      page = { ...page, canRequest: true, requests: [row] };
      return row;
    },
    async reportDeliveryReceipt() {
      reports++;
      const row = {
        ...page.requests[0]!,
        ownerReportedReceivedAt: new Date().toISOString(),
      };
      page = { ...page, requests: [row] };
      return row;
    },
  };
  return {
    methods,
    get page() {
      return page;
    },
    set page(next: CollectorDeliveryReview) {
      page = next;
    },
    get writes() {
      return writes;
    },
    get reports() {
      return reports;
    },
    cancels,
    change() {
      auth = { status: "signed-out", session: null, error: null };
      for (const fn of listeners) fn();
    },
  };
}
function input(requestId: string): FulfillmentCreateRequest {
  return {
    requestId,
    kind: "DELIVERY",
    recipientName: "Synthetic",
    contactEmail: "synthetic@example.invalid",
    contactPhone: null,
    addressLines: ["Synthetic address"],
    city: "Synthetic",
    region: null,
    postalCode: null,
    countryCode: "NP",
    deliveryInstructions: null,
  };
}
test("delivery creates one private request and requires explicit dispatched receipt confirmation", async () => {
  const f = fixture(),
    c = createCollectorDelivery(f.methods, kathaId);
  await c.read();
  const id = c.getSnapshot().requestId!;
  await c.create(input(id));
  assert.equal(f.writes, 1);
  assert.notEqual(c.getSnapshot().requestId, id);
  await c.report(id, true);
  assert.equal(f.reports, 0);
  f.page = {
    ...f.page,
    custodyState: "IN_TRANSIT",
    requests: [{ ...f.page.requests[0]!, status: "DISPATCHED" }],
  };
  await c.read();
  await c.report(id, false);
  assert.equal(f.reports, 0);
  await c.report(id, true);
  assert.equal(f.reports, 1);
  assert.equal(c.getSnapshot().page?.requests[0]?.status, "DISPATCHED");
  assert.equal(c.getSnapshot().page?.custodyState, "IN_TRANSIT");
  await c.report(id, true);
  assert.equal(f.reports, 1);
  f.change();
  assert.equal(c.getSnapshot().page, null);
  assert.equal(c.getSnapshot().requestId, null);
  c.dispose();
});
test("uncertain delivery writes clear private data and retain the retry UUID until refreshed", async () => {
  const f = fixture();
  f.methods.createDelivery = async () => {
    throw new Error("PRIVATE ADDRESS");
  };
  const c = createCollectorDelivery(f.methods, kathaId);
  await c.read();
  const id = c.getSnapshot().requestId!;
  await c.create(input(id));
  assert.equal(c.getSnapshot().page, null);
  assert.equal(c.getSnapshot().reloadRequired, true);
  assert.equal(c.getSnapshot().requestId, id);
  assert.doesNotMatch(c.getSnapshot().error!, /PRIVATE/);
  await c.read();
  assert.equal(c.getSnapshot().reloadRequired, false);
  assert.equal(c.getSnapshot().requestId, id);
  c.dispose();
});
test("late private reads are discarded after signout and wrong-owner responses are rejected", async () => {
  const f = fixture();
  let resolve!: (value: CollectorDeliveryReview) => void;
  f.methods.readDelivery = () =>
    new Promise((r) => {
      resolve = r;
    });
  const c = createCollectorDelivery(f.methods, kathaId);
  const pending = c.read();
  f.change();
  resolve(initial);
  await pending;
  assert.equal(c.getSnapshot().page, null);
  c.dispose();
  const other = fixture();
  other.page = { ...initial, ownerWallet: "11111111111111111111111111111113" };
  const rejected = createCollectorDelivery(other.methods, kathaId);
  await rejected.read();
  assert.equal(rejected.getSnapshot().page, null);
  rejected.dispose();
});
test("private delivery transport uses bearer, no-store and validates response identity", async () => {
  let body = initial;
  const api = createWalletSessionApi("http://localhost:3001", async (url, init) => {
    assert.equal(
      String(url),
      `http://localhost:3001/fulfillment/artworks/${kathaId}?limit=20&offset=0`,
    );
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.credentials, "omit");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic");
    return Response.json(body);
  });
  const signal = new AbortController().signal;
  assert.equal(
    (await api.readDelivery(kathaId, { limit: 20, offset: 0 }, "synthetic", signal))
      .kathaId,
    kathaId,
  );
  body = { ...initial, kathaId: "KATHA-PAUBHA-000002" };
  await assert.rejects(
    api.readDelivery(kathaId, { limit: 20, offset: 0 }, "synthetic", signal),
  );
});
test("returns to Katha are offered only while the owner holds the work and none is open", async () => {
  const f = fixture();
  f.page = { ...initial, custodyState: "COLLECTOR_HELD", canRequest: false };
  const c = createCollectorDelivery(f.methods, kathaId);
  await c.read();
  const id = c.getSnapshot().requestId!;
  await c.create(input(id));
  assert.equal(f.writes, 0, "delivery is refused while the collector holds the work");
  await c.create({ ...input(id), kind: "RETURN_TO_KATHA" });
  assert.equal(f.writes, 1);
  f.page = {
    ...f.page,
    custodyState: "COLLECTOR_HELD",
    requests: [{ ...f.page.requests[0]!, kind: "RETURN_TO_KATHA", status: "APPROVED" }],
  };
  await c.read();
  await c.create({ ...input(c.getSnapshot().requestId!), kind: "RETURN_TO_KATHA" });
  assert.equal(f.writes, 1, "an open return blocks another");
  f.page = { ...initial, custodyState: "KATHA_HELD", canRequest: true };
  await c.read();
  await c.create({ ...input(c.getSnapshot().requestId!), kind: "RETURN_TO_KATHA" });
  assert.equal(f.writes, 1, "a Katha-held work cannot be returned");
  c.dispose();
});

test("the requester can withdraw a request only before dispatch, with explicit confirmation", async () => {
  const f = fixture(),
    c = createCollectorDelivery(f.methods, kathaId);
  await c.read();
  await c.create(input(c.getSnapshot().requestId!));
  const id = c.getSnapshot().page!.requests[0]!.id;
  await c.cancel(id, false);
  assert.deepEqual(f.cancels, []);
  await c.cancel(id, true);
  assert.deepEqual(f.cancels, [id]);
  assert.equal(c.getSnapshot().page?.requests[0]?.status, "CANCELLED");
  // A cancelled, dispatched or unknown request can't be withdrawn.
  await c.cancel(id, true);
  await c.cancel("00000000-0000-4000-8000-000000000000", true);
  f.page = {
    ...f.page,
    requests: [{ ...f.page.requests[0]!, status: "DISPATCHED" }],
  };
  await c.read();
  await c.cancel(id, true);
  assert.deepEqual(f.cancels, [id]);
  c.dispose();
});
