import assert from "node:assert/strict";
import { test } from "node:test";
import { custodyFixture } from "./fixtures/custody.ts";
import { inspectPreparedTransaction } from "../lib/prepared-transaction.ts";
import { createCustodyAdministrationWorkflow } from "../lib/custody-administration.ts";
import {
  createWalletSessionApi,
  WalletSessionApiError,
} from "../lib/wallet-session-api.ts";
import { idleTransactionSnapshot } from "../lib/transaction-lifecycle.ts";
import type { WalletSessionSnapshot } from "../lib/wallet-session.ts";
import type { FulfillmentUpdateRequest } from "@katha/shared";
for (const action of [
  "ATTEST_KATHA_CUSTODY",
  "ATTEST_COLLECTOR_CUSTODY",
  "DISPATCH_FROM_KATHA",
  "DISPATCH_FROM_COLLECTOR",
  "RECEIVE_AT_KATHA",
  "RECEIVE_BY_COLLECTOR",
])
  test(`binds generated ${action} without ownership transfers`, async () => {
    const f = await custodyFixture(action);
    await inspectPreparedTransaction(f.operation, {
      wallet: f.operation.feePayer,
      cluster: "localnet",
      kind: "UPDATE_CUSTODY",
      kathaId: f.page.kathaId,
      custody: {
        transition: f.transition,
        collectorWallet: f.collectorWallet,
        expectedCustodyRevision: f.page.chain.revision,
      },
    });
  });
for (const [name, override] of Object.entries({
  revision: { revision: 2n },
  collector: { collector: "11111111111111111111111111111114" },
  head: { head: "11111111111111111111111111111114" },
  transition: { transition: "11111111111111111111111111111114" },
  system: { systemProgram: "11111111111111111111111111111114" },
  extra: { extraAccount: "11111111111111111111111111111114" },
}))
  test(`rejects changed custody ${name} before simulation`, async () => {
    const f = await custodyFixture("RECEIVE_BY_COLLECTOR", undefined, override);
    await assert.rejects(
      inspectPreparedTransaction(f.operation, {
        wallet: f.operation.feePayer,
        cluster: "localnet",
        kind: "UPDATE_CUSTODY",
        kathaId: f.page.kathaId,
        custody: {
          transition: f.transition,
          collectorWallet: f.collectorWallet,
          expectedCustodyRevision: "1",
        },
      }),
    );
  });
test("rejects an unbound custody preparation", async () => {
  const f = await custodyFixture();
  await assert.rejects(
    inspectPreparedTransaction(f.operation, {
      wallet: f.operation.feePayer,
      cluster: "localnet",
      kind: "UPDATE_CUSTODY",
      kathaId: f.page.kathaId,
    }),
  );
});
async function fixture(admin = true) {
  const f = await custodyFixture();
  let auth: WalletSessionSnapshot = {
    status: "signed-in",
    error: null,
    session: {
      walletId: "aaaaaaaa-1111-4111-8111-111111111111",
      walletAddress: f.operation.feePayer,
      cluster: "localnet",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
  };
  const listeners = new Set<() => void>();
  let reads = 0,
    updates = 0,
    preparations = 0,
    loads = 0,
    forbidden = false,
    uncertain = false;
  let delay: Promise<void> | null = null;
  const session = {
    getSnapshot: () => auth,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    permissions: async () => ({ session: auth.session!, admin, verifier: true }),
    readCustody: async () => {
      reads++;
      if (delay) await delay;
      if (forbidden) throw new WalletSessionApiError("FORBIDDEN");
      return f.page;
    },
    updateFulfillment: async (_id: string, input: FulfillmentUpdateRequest) => {
      updates++;
      if (uncertain) throw new Error("Uncertain");
      const r = f.page.requests[0]!.request;
      r.status = input.status;
      r.updatedAt = "2026-10-06T00:00:01.000Z";
      return r;
    },
    prepareCustody: async () => {
      preparations++;
      return f.operation;
    },
  };
  const connection = {
    cluster: "localnet" as const,
    getSnapshot: () => ({
      status: "connected" as const,
      wallets: [],
      connected: {
        walletId: "test",
        walletName: "Synthetic",
        supportsMessageSigning: true,
        accounts: [f.operation.feePayer],
        supportsV0: true,
        supportsV1: false,
        address: f.operation.feePayer,
      },
    }),
    subscribe: session.subscribe,
  };
  const workflow = createCustodyAdministrationWorkflow(
    session,
    connection,
    {
      getSnapshot: () => idleTransactionSnapshot,
      load: async () => {
        loads++;
      },
    },
    f.page.kathaId,
  );
  return {
    ...f,
    workflow,
    counts: () => ({ reads, updates, preparations, loads }),
    signOut() {
      auth = { status: "signed-out", error: null, session: null };
      for (const fn of listeners) fn();
    },
    forbid() {
      forbidden = true;
    },
    uncertain() {
      uncertain = true;
    },
    delay(value: Promise<void>) {
      delay = value;
    },
  };
}
const prepareInput = (f: Awaited<ReturnType<typeof fixture>>) => ({
  expectedUpdatedAt: f.page.updatedAt,
  expectedCustodyRevision: f.page.chain.revision,
  transition: f.transition,
  collectorWallet: f.collectorWallet,
  movementConfirmed: true as const,
  idempotencyKey: "synthetic-custody",
  supportedTransactionVersions: [0 as const],
});
test("administrator role precedes all private reads", async () => {
  const f = await fixture(false);
  await f.workflow.read();
  assert.equal(f.counts().reads, 0);
  assert.equal(f.workflow.getSnapshot().page, null);
  f.workflow.dispose();
});
test("prepares movement separately without automatic signing", async () => {
  const f = await fixture();
  await f.workflow.read();
  await f.workflow.prepare(prepareInput(f));
  assert.equal(f.counts().preparations, 1);
  assert.equal(f.counts().loads, 1);
  assert.equal(f.counts().updates, 0);
  f.workflow.dispose();
});
test("fulfillment update keeps custody unchanged", async () => {
  const f = await fixture();
  await f.workflow.read();
  await f.workflow.update(f.page.requests[0]!.request.id, {
    expectedUpdatedAt: f.page.updatedAt,
    status: "APPROVED",
    manualConfirmation: true,
  });
  assert.equal(f.counts().updates, 1);
  assert.equal(f.page.chain.state, "UNKNOWN");
  assert.equal(f.counts().loads, 0);
  f.workflow.dispose();
});
test("unresolved signature and wrong authority block replacements", async () => {
  const f = await fixture();
  await f.workflow.read();
  f.page.custody.unresolved = true;
  await f.workflow.prepare(prepareInput(f));
  f.page.custody.unresolved = false;
  f.page.canAttest = false;
  await f.workflow.prepare(prepareInput(f));
  assert.equal(f.counts().preparations, 0);
  f.workflow.dispose();
});
test("stale revision and unrelated fulfillment fail closed", async () => {
  const f = await fixture();
  await f.workflow.read();
  await f.workflow.prepare({ ...prepareInput(f), expectedCustodyRevision: "2" });
  assert.equal(f.counts().preparations, 0);
  await f.workflow.read();
  await f.workflow.prepare({
    ...prepareInput(f),
    fulfillmentId: f.page.requests[0]!.request.id,
  });
  assert.equal(f.counts().preparations, 0);
  f.workflow.dispose();
});
test("uncertain write requires reload before retry", async () => {
  const f = await fixture();
  await f.workflow.read();
  f.uncertain();
  const input = {
    expectedUpdatedAt: f.page.updatedAt,
    status: "APPROVED" as const,
    manualConfirmation: true as const,
  };
  await f.workflow.update(f.page.requests[0]!.request.id, input);
  await f.workflow.update(f.page.requests[0]!.request.id, input);
  assert.equal(f.counts().updates, 1);
  assert.equal(f.workflow.getSnapshot().reloadRequired, true);
  f.workflow.dispose();
});
test("signout clears contact details and rejects late private results", async () => {
  const f = await fixture();
  await f.workflow.read();
  assert.ok(f.workflow.getSnapshot().page);
  let release!: () => void;
  f.delay(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const pending = f.workflow.read();
  f.signOut();
  release();
  await pending;
  assert.equal(f.workflow.getSnapshot().page, null);
  assert.equal(f.workflow.getSnapshot().busy, false);
  f.workflow.dispose();
});
test("revoked role clears previously displayed shipping data", async () => {
  const f = await fixture();
  await f.workflow.read();
  f.forbid();
  await f.workflow.read();
  assert.equal(f.workflow.getSnapshot().page, null);
  f.workflow.dispose();
});
test("typed private transport validates route and identity", async () => {
  const f = await custodyFixture();
  let calls = 0;
  const api = createWalletSessionApi("http://localhost:3001", async (url, init) => {
    calls++;
    assert.equal(
      String(url),
      `http://localhost:3001/admin/artworks/${f.page.kathaId}/custody?limit=20&offset=0`,
    );
    assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic");
    return Response.json(f.page);
  });
  await api.readCustody(
    f.page.kathaId,
    { limit: 20, offset: 0 },
    "synthetic",
    new AbortController().signal,
  );
  await assert.rejects(
    api.readCustody(
      "../private",
      { limit: 20, offset: 0 },
      "synthetic",
      new AbortController().signal,
    ),
  );
  assert.equal(calls, 1);
});
