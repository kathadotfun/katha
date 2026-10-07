import assert from "node:assert/strict";
import { test } from "node:test";
import { metadataFixture } from "./fixtures/metadata.ts";
import { inspectPreparedTransaction } from "../lib/prepared-transaction.ts";
import { createMetadataRevisionWorkflow } from "../lib/metadata-revisions.ts";
import { idleTransactionSnapshot } from "../lib/transaction-lifecycle.ts";
import type { WalletSessionSnapshot } from "../lib/wallet-session.ts";
import {
  createWalletSessionApi,
  WalletSessionApiError,
} from "../lib/wallet-session-api.ts";
import {
  metadataDocumentSchema,
  metadataRevisionDocumentRequestSchema,
  type MetadataRevisionRequest,
} from "@katha/shared";
const context = (f: Awaited<ReturnType<typeof metadataFixture>>) => ({
  wallet: f.operation.feePayer,
  cluster: "localnet" as const,
  kind: "REVISE_METADATA" as const,
  kathaId: f.page.kathaId,
  metadata: f.review,
});
for (const mode of ["INITIALIZE", "UNMINTED", "MINTED"] as const)
  test(`binds ${mode} metadata transaction to reviewed bytes and version`, async () => {
    const f = await metadataFixture(mode);
    await inspectPreparedTransaction(f.operation, context(f));
  });
for (const name of [
  "config",
  "artwork",
  "head",
  "currentRevision",
  "revision",
  "collection",
  "collectionAuthority",
  "asset",
  "systemProgram",
  "coreProgram",
])
  test(`rejects forged metadata ${name}`, async () => {
    const f = await metadataFixture("MINTED", {
      [name]: "11111111111111111111111111111115",
    });
    await assert.rejects(inspectPreparedTransaction(f.operation, context(f)));
  });
for (const changes of [
  { uri: "http://localhost/changed.json" },
  { documentHash: new Uint8Array(32).fill(3) },
  { expectedVersion: 2 },
  { nextVersion: 3 },
])
  test(`rejects metadata argument mutation ${Object.keys(changes)[0]}`, async () => {
    const f = await metadataFixture("MINTED", {}, changes);
    await assert.rejects(inspectPreparedTransaction(f.operation, context(f)));
  });
test("requires explicit metadata review and rejects altered canonical bytes", async () => {
  const f = await metadataFixture();
  const { metadata, ...unreviewed } = context(f);
  await assert.rejects(inspectPreparedTransaction(f.operation, unreviewed));
  assert.ok(metadata);
  f.review.metadata!.canonicalDocument += " ";
  await assert.rejects(inspectPreparedTransaction(f.operation, context(f)));
});
async function workflowFixture(admin = true) {
  const f = await metadataFixture();
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
    loads = 0,
    saves = 0,
    flow = idleTransactionSnapshot,
    conflict = false;
  const preparations: MetadataRevisionRequest[] = [];
  const session = {
    getSnapshot: () => auth,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    permissions: async () => ({ admin, verifier: false, session: auth.session! }),
    readMetadataRevisions: async () => {
      reads++;
      return structuredClone(f.page);
    },
    prepareMetadataRevision: async (_id: string, input: MetadataRevisionRequest) => {
      preparations.push(input);
      if (conflict) throw new WalletSessionApiError("CONFLICT");
      return f.operation;
    },
    saveMetadataRevisionDocument: async () => {
      saves++;
      if (conflict) throw new WalletSessionApiError("CONFLICT");
      return structuredClone(f.page);
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
  const transactions = {
    getSnapshot: () => flow,
    load: async () => {
      loads++;
    },
  };
  const workflow = createMetadataRevisionWorkflow(
    session,
    connection,
    transactions,
    f.page.kathaId,
  );
  return {
    ...f,
    workflow,
    preparations,
    counts: () => ({ reads, loads, saves }),
    setConflict() {
      conflict = true;
    },
    setUnknown() {
      flow = {
        ...idleTransactionSnapshot,
        phase: "unknown",
        signature: "1".repeat(88),
      };
    },
    signOut() {
      auth = { status: "signed-out", session: null, error: null };
      for (const fn of listeners) fn();
    },
  };
}
test("review and prepare never sign automatically, retain stable intent and clear on sign-out", async () => {
  const f = await workflowFixture();
  try {
    await f.workflow.read();
    await f.workflow.prepare(false);
    assert.equal(f.counts().loads, 0);
    await f.workflow.prepare(true);
    await f.workflow.prepare(true);
    assert.equal(f.counts().loads, 2);
    assert.equal(f.preparations[0]!.idempotencyKey, f.preparations[1]!.idempotencyKey);
    assert.equal(f.preparations[0]!.expectedMetadataHash, f.page.chain.documentHash);
    f.signOut();
    assert.equal(f.workflow.getSnapshot().page, null);
  } finally {
    f.workflow.dispose();
  }
});
test("non-admins and unknown signatures cannot prepare or save", async () => {
  const denied = await workflowFixture(false);
  try {
    await denied.workflow.read();
    assert.equal(denied.counts().reads, 0);
  } finally {
    denied.workflow.dispose();
  }
  const f = await workflowFixture();
  try {
    await f.workflow.read();
    f.setUnknown();
    await f.workflow.prepare(true);
    assert.equal(f.counts().loads, 0);
  } finally {
    f.workflow.dispose();
  }
});
test("uncertain preparation requires reload and preserves the reviewed document", async () => {
  const f = await workflowFixture();
  try {
    await f.workflow.read();
    f.setConflict();
    await f.workflow.prepare(true);
    assert.equal(f.workflow.getSnapshot().reloadRequired, true);
    assert.equal(f.counts().loads, 0);
    await f.workflow.prepare(true);
    assert.equal(f.preparations.length, 1);
  } finally {
    f.workflow.dispose();
  }
});
test("private metadata API uses authenticated no-store calls and rejects identity swaps", async () => {
  const f = await metadataFixture(),
    calls: RequestInit[] = [];
  const api = createWalletSessionApi("http://localhost:3001", async (_url, input) => {
    calls.push(input!);
    return new Response(JSON.stringify(f.page), {
      headers: { "content-type": "application/json" },
    });
  });
  await api.readMetadataRevisions(
    f.page.kathaId,
    "temporary-token",
    new AbortController().signal,
  );
  assert.equal(calls[0]!.cache, "no-store");
  assert.equal(
    new Headers(calls[0]!.headers).get("Authorization"),
    "Bearer temporary-token",
  );
  const wrong = createWalletSessionApi(
    "http://localhost:3001",
    async () =>
      new Response(JSON.stringify({ ...f.page, kathaId: "KATHA-PAUBHA-000051" }), {
        headers: { "content-type": "application/json" },
      }),
  );
  await assert.rejects(
    wrong.readMetadataRevisions(
      f.page.kathaId,
      "temporary-token",
      new AbortController().signal,
    ),
  );
});
test("document editing excludes attribution, URI and arbitrary JSON", () => {
  const input = {
    expectedUpdatedAt: "2026-10-07T00:00:00.000Z",
    metadataVersionId: "cccccccc-1111-4111-8111-111111111111",
    publicContent: {
      story: "Public story",
      meaning: "Meaning",
      culturalContext: "Culture",
      creationProcess: "Process",
    },
    publicApprovalConfirmed: true,
  };
  assert.ok(metadataRevisionDocumentRequestSchema.safeParse(input).success);
  for (const key of ["artist", "kathaId", "uri", "media", "canonicalDocument"])
    assert.equal(
      metadataRevisionDocumentRequestSchema.safeParse({ ...input, [key]: "changed" })
        .success,
      false,
    );
  assert.equal(
    metadataRevisionDocumentRequestSchema.safeParse({
      ...input,
      publicApprovalConfirmed: false,
    }).success,
    false,
  );
});

test("saving requires public approval and unknown signatures block changed documents", async () => {
  const f = await workflowFixture();
  try {
    await f.workflow.read();
    const content = {
      ...metadataDocumentSchema.parse(JSON.parse(f.page.metadata!.canonicalDocument))
        .publicContent,
      story: "Another approved public story",
    };
    await f.workflow.save(content, false);
    assert.equal(f.counts().saves, 0);
    f.setUnknown();
    await f.workflow.save(content, true);
    assert.equal(f.counts().saves, 0);
  } finally {
    f.workflow.dispose();
  }
});
test("an indexing gap remains reviewable and cannot prepare a revision", async () => {
  const f = await workflowFixture();
  try {
    f.page.chain.documentHash = "a".repeat(64);
    f.page.canSave = false;
    f.page.canSubmit = false;
    await f.workflow.read();
    assert.ok(f.workflow.getSnapshot().page);
    await f.workflow.prepare(true);
    assert.equal(f.counts().loads, 0);
  } finally {
    f.workflow.dispose();
  }
});
