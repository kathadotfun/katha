import assert from "node:assert/strict";
import { test } from "node:test";
import { mintingFixture } from "./fixtures/minting.ts";
import { inspectPreparedTransaction } from "../lib/prepared-transaction.ts";
import { createArtworkMintingWorkflow } from "../lib/artwork-minting.ts";
import {
  createWalletSessionApi,
  WalletSessionApiError,
} from "../lib/wallet-session-api.ts";
import { idleTransactionSnapshot } from "../lib/transaction-lifecycle.ts";
import type { WalletSessionSnapshot } from "../lib/wallet-session.ts";
import {
  artworkMintReviewSchema,
  artworkPublicationRequestSchema,
  type ArtworkMintRequest,
} from "@katha/shared";
test("binds every generated Core mint account to the reviewed permanent identity", async () => {
  const f = await mintingFixture();
  await inspectPreparedTransaction(f.operation, {
    wallet: f.operation.feePayer,
    cluster: "localnet",
    kind: "MINT_ARTWORK",
    kathaId: f.page.kathaId,
    mint: f.review,
  });
});
for (const name of [
  "artwork",
  "verification",
  "metadataHead",
  "metadataRevision",
  "conditionHead",
  "initialCondition",
  "custodyHead",
  "collection",
  "collectionAuthority",
  "asset",
  "systemProgram",
  "coreProgram",
])
  test(`rejects changed mint ${name}`, async () => {
    const f = await mintingFixture(undefined, {
      [name]: "11111111111111111111111111111115",
    });
    await assert.rejects(
      inspectPreparedTransaction(f.operation, {
        wallet: f.operation.feePayer,
        cluster: "localnet",
        kind: "MINT_ARTWORK",
        kathaId: f.page.kathaId,
        mint: f.review,
      }),
    );
  });
test("rejects unbound mint and stale metadata/report review", async () => {
  const f = await mintingFixture(),
    context = {
      wallet: f.operation.feePayer,
      cluster: "localnet" as const,
      kind: "MINT_ARTWORK" as const,
      kathaId: f.page.kathaId,
    };
  await assert.rejects(inspectPreparedTransaction(f.operation, context));
  await assert.rejects(
    inspectPreparedTransaction(f.operation, {
      ...context,
      mint: { ...f.review, metadataVersion: 2 },
    }),
  );
  await assert.rejects(
    inspectPreparedTransaction(f.operation, {
      ...context,
      mint: {
        ...f.review,
        initialConditionReportId: "bbbbbbbb-1111-4111-8111-111111111111",
      },
    }),
  );
});
async function fixture(admin = true) {
  const f = await mintingFixture();
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
  let loads = 0,
    reads = 0,
    publications = 0,
    conflict = false,
    flow = idleTransactionSnapshot;
  const preparations: ArtworkMintRequest[] = [];
  const session = {
    getSnapshot: () => auth,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    permissions: async () => ({ admin, verifier: false, session: auth.session! }),
    readMinting: async () => {
      reads++;
      return structuredClone(f.page);
    },
    prepareMint: async (_id: string, input: ArtworkMintRequest) => {
      preparations.push(input);
      if (conflict) throw new WalletSessionApiError("CONFLICT");
      return f.operation;
    },
    publishArtwork: async () => {
      publications++;
      if (conflict) throw new WalletSessionApiError("CONFLICT");
      return { ...f.page, published: true, canPublish: false };
    },
  };
  const connection = {
    cluster: "localnet" as const,
    getSnapshot: () => ({
      connected: {
        walletId: "temporary",
        walletName: "Synthetic",
        address: f.operation.feePayer,
        accounts: [f.operation.feePayer],
        supportsMessageSigning: true,
        supportsV0: true,
        supportsV1: false,
      },
      wallets: [],
      status: "connected" as const,
      error: null,
    }),
    subscribe: () => () => {},
  };
  const workflow = createArtworkMintingWorkflow(
    session,
    connection,
    {
      getSnapshot: () => flow,
      load: async () => {
        loads++;
      },
    },
    f.page.kathaId,
  );
  return {
    ...f,
    workflow,
    count: () => ({ loads, reads, publications, preparations }),
    revoke: () => {
      auth = { status: "signed-out", error: null, session: null };
      for (const fn of listeners) fn();
    },
    conflict: () => {
      conflict = true;
    },
    unknown: () => {
      flow = {
        ...idleTransactionSnapshot,
        phase: "unknown",
        signature: "AB".repeat(44),
      };
    },
  };
}
test("requires explicit mint review, reuses reserved intent and never publishes during preparation", async () => {
  const f = await fixture();
  f.page.reservation = {
    idempotencyKey: "retained-original-intent",
    walletAddress: f.operation.feePayer,
    status: "PREPARED",
  };
  await f.workflow.read();
  await f.workflow.prepare(false);
  assert.equal(f.count().loads, 0);
  await f.workflow.prepare(true);
  assert.equal(f.count().loads, 1);
  assert.equal(f.count().publications, 0);
  assert.equal(f.count().preparations[0]!.idempotencyKey, "retained-original-intent");
  f.workflow.dispose();
});
test("blocks writes on UNKNOWN signatures and clears private review on sign-out", async () => {
  const f = await fixture();
  await f.workflow.read();
  f.unknown();
  await f.workflow.prepare(true);
  assert.equal(f.count().loads, 0);
  f.revoke();
  assert.equal(f.workflow.getSnapshot().page, null);
  f.workflow.dispose();
});
test("denies non-admin private reads and rejects canonical metadata tampering", async () => {
  const f = await fixture(false);
  await f.workflow.read();
  assert.equal(f.count().reads, 0);
  assert.equal(f.workflow.getSnapshot().page, null);
  f.workflow.dispose();
  const changed = await fixture();
  changed.page.metadata!.canonicalDocument = "{}";
  await changed.workflow.read();
  assert.equal(changed.workflow.getSnapshot().page, null);
  assert.ok(changed.workflow.getSnapshot().error);
  changed.workflow.dispose();
});
test("publishes only after finalized readiness and a separate confirmation", async () => {
  const f = await fixture();
  await f.workflow.read();
  await f.workflow.publish(true);
  assert.equal(f.count().publications, 0);
  f.page.chain!.minted = true;
  f.page.chain!.owner = f.operation.feePayer;
  f.page.canMint = false;
  f.page.canPublish = true;
  await f.workflow.read();
  await f.workflow.publish(false);
  assert.equal(f.count().publications, 0);
  await f.workflow.publish(true);
  assert.equal(f.count().publications, 1);
  assert.equal(f.workflow.getSnapshot().page?.published, true);
  f.workflow.dispose();
});
test("uncertain publication requires saved-state reload before retry", async () => {
  const f = await fixture();
  f.page.chain!.minted = true;
  f.page.canPublish = true;
  await f.workflow.read();
  f.conflict();
  await f.workflow.publish(true);
  assert.equal(f.workflow.getSnapshot().reloadRequired, true);
  await f.workflow.publish(true);
  assert.equal(f.count().publications, 1);
  f.workflow.dispose();
});
test("strict publication boundary rejects missing confirmation and extra private fields", () => {
  assert.equal(
    artworkPublicationRequestSchema.safeParse({
      expectedUpdatedAt: "2026-10-07T00:00:00.000Z",
      publicationConfirmed: false,
    }).success,
    false,
  );
  assert.equal(
    artworkPublicationRequestSchema.safeParse({
      expectedUpdatedAt: "2026-10-07T00:00:00.000Z",
      publicationConfirmed: true,
      notes: "private",
    }).success,
    false,
  );
});
test("typed protected mint and publication requests enforce identity and operation kind", async () => {
  const f = await mintingFixture(),
    signal = new AbortController().signal;
  const requests: {
    url: string;
    method: string | undefined;
    authorization: string | null;
    cache: RequestCache | undefined;
  }[] = [];
  const api = createWalletSessionApi("http://localhost:3001", async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method,
      authorization: new Headers(init?.headers).get("authorization"),
      cache: init?.cache,
    });
    return new Response(
      JSON.stringify(
        String(input).endsWith("publication") ? { ...f.page, published: true } : f.page,
      ),
      { headers: { "content-type": "application/json" } },
    );
  });
  await api.readMinting(f.page.kathaId, "temporary-token", signal);
  await api.publishArtwork(
    f.page.kathaId,
    { expectedUpdatedAt: f.page.updatedAt, publicationConfirmed: true },
    "temporary-token",
    signal,
  );
  assert.equal(requests[0]?.method, "GET");
  assert.equal(requests[1]?.method, "POST");
  assert.ok(
    requests.every(
      (r) => r.authorization === "Bearer temporary-token" && r.cache === "no-store",
    ),
  );
  const wrong = createWalletSessionApi(
    "http://localhost:3001",
    async () =>
      new Response(JSON.stringify({ ...f.page, kathaId: "KATHA-PAUBHA-000051" }), {
        headers: { "content-type": "application/json" },
      }),
  );
  await assert.rejects(wrong.readMinting(f.page.kathaId, "temporary-token", signal));
  artworkMintReviewSchema.parse(f.page);
});
