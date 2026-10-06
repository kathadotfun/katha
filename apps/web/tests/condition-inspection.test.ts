import assert from "node:assert/strict";
import { test } from "node:test";
import { conditionFixture } from "./fixtures/condition.ts";
import { inspectPreparedTransaction } from "../lib/prepared-transaction.ts";
import {
  createConditionInspectionWorkflow,
  validateConditionDocument,
} from "../lib/condition-inspection.ts";
import {
  WalletSessionApiError,
  createWalletSessionApi,
} from "../lib/wallet-session-api.ts";
import {
  idleTransactionSnapshot,
  type TransactionLifecycle,
} from "../lib/transaction-lifecycle.ts";
import type { WalletSessionSnapshot } from "../lib/wallet-session.ts";
import type { WalletConnectionSnapshot } from "../lib/wallet-connection.ts";
import {
  canonicalDocumentBytes,
  sha256Hex,
  type ConditionPreparationRequest,
} from "@katha/shared";
for (const mode of ["initial", "unminted", "minted"] as const)
  test(`binds ${mode} report to generated transaction bytes`, async () => {
    const f = await conditionFixture(mode);
    await inspectPreparedTransaction(f.operation, {
      wallet: f.operation.feePayer,
      cluster: "localnet",
      kind: "RECORD_CONDITION",
      kathaId: f.page.kathaId,
      condition: {
        document: f.document,
        reportHash: f.page.report!.documentHash,
        expectedVersion: f.page.chain.version,
      },
    });
  });
for (const [name, override] of Object.entries({
  hash: { hash: "b".repeat(64) },
  version: { expectedVersion: 2 },
  owner: { owner: "11111111111111111111111111111113" },
  custody: { revision: 2n },
  report: { reportAddress: "11111111111111111111111111111113" },
  head: { headAddress: "11111111111111111111111111111113" },
  system: { systemProgram: "11111111111111111111111111111113" },
  extra: { extraAccount: "11111111111111111111111111111113" },
}))
  test(`rejects changed ${name} before simulation/signing`, async () => {
    const f = await conditionFixture("minted", undefined, override);
    await assert.rejects(
      inspectPreparedTransaction(f.operation, {
        wallet: f.operation.feePayer,
        cluster: "localnet",
        kind: "RECORD_CONDITION",
        kathaId: f.page.kathaId,
        condition: {
          document: f.document,
          reportHash: f.page.report!.documentHash,
          expectedVersion: f.page.chain.version,
        },
      }),
    );
  });
async function fixture(verifier = true) {
  const f = await conditionFixture();
  let auth: WalletSessionSnapshot = {
    status: "signed-in",
    error: null,
    session: {
      walletId: f.document.inspectorId,
      walletAddress: f.document.verifierWallet,
      cluster: "localnet",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
  };
  const listeners = new Set<() => void>();
  let flow = idleTransactionSnapshot,
    calls = 0,
    loads = 0,
    readError = false;
  const session = {
    getSnapshot: () => auth,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    permissions: async () => ({ session: auth.session!, admin: false, verifier }),
    readCondition: async () => {
      if (readError) throw new WalletSessionApiError("FORBIDDEN");
      return f.page;
    },
    uploadConditionEvidence: async () => f.page,
    prepareConditionDocument: async (
      id: string,
      input: ConditionPreparationRequest,
    ) => {
      calls++;
      const { expectedUpdatedAt, mediaIds, ...fields } = input;
      assert.equal(expectedUpdatedAt, f.page.updatedAt);
      const document = {
        ...fields,
        kathaId: id,
        verifierWallet: auth.session!.walletAddress,
        mediaHashes: mediaIds.map(
          (mediaId) => f.page.media.find((row) => row.id === mediaId)!.contentHash,
        ),
      };
      const bytes = canonicalDocumentBytes(document),
        hash = await sha256Hex(bytes);
      f.page.report = {
        id: input.reportId,
        version: 2,
        status: "PREPARED",
        documentHash: hash,
        canonicalDocument: new TextDecoder().decode(bytes),
      };
      return {
        id: input.reportId,
        kathaId: id,
        version: 2,
        status: "PREPARED" as const,
        documentHash: hash,
        uri: null,
      };
    },
    prepareConditionAttestation: async () => {
      calls++;
      return f.operation;
    },
  };
  const connection = {
    cluster: "localnet" as const,
    subscribe: session.subscribe,
    getSnapshot: (): WalletConnectionSnapshot => ({
      status: "connected",
      wallets: [],
      connected: {
        walletId: "synthetic",
        walletName: "Synthetic",
        address: f.document.verifierWallet,
        accounts: [f.document.verifierWallet],
        supportsV0: true,
        supportsV1: false,
        supportsMessageSigning: true,
      },
    }),
  };
  const transactions = {
    getSnapshot: () => flow,
    load: async (
      input: unknown,
      expected: Parameters<TransactionLifecycle["load"]>[1],
    ) => {
      loads++;
      await inspectPreparedTransaction(input, {
        ...expected,
        wallet: f.document.verifierWallet,
        cluster: "localnet",
      });
    },
  };
  const workflow = createConditionInspectionWorkflow(
    session,
    connection,
    transactions,
    f.page.kathaId,
  );
  return {
    ...f,
    workflow,
    session,
    calls: () => calls,
    loads: () => loads,
    setFlow: (value: typeof flow) => {
      flow = value;
    },
    revoke: () => {
      readError = true;
    },
    signOut: () => {
      auth = { status: "signed-out", session: null, error: null };
      for (const fn of listeners) fn();
    },
  };
}
test("verifier-only read requires a separate explicit attestation approval", async () => {
  const f = await fixture();
  await f.workflow.read();
  await f.workflow.prepareAttestation(false);
  assert.equal(f.calls(), 0);
  await f.workflow.prepareAttestation(true);
  assert.equal(f.loads(), 1);
  assert.equal(f.workflow.getSnapshot().error, null);
  f.workflow.dispose();
});
test("unknown receipts block new reports and attestation", async () => {
  const f = await fixture();
  f.page.unresolved = true;
  await f.workflow.read();
  await f.workflow.prepareAttestation(true);
  assert.equal(f.calls(), 0);
  f.workflow.dispose();
});
test("role denial and revocation clear private inspection data", async () => {
  const denied = await fixture(false);
  await denied.workflow.read();
  assert.equal(denied.workflow.getSnapshot().page, null);
  denied.workflow.dispose();
  const f = await fixture();
  await f.workflow.read();
  f.revoke();
  await f.workflow.read();
  assert.equal(f.workflow.getSnapshot().page, null);
  f.workflow.dispose();
});
test("sign-out removes private report state", async () => {
  const f = await fixture();
  await f.workflow.read();
  f.signOut();
  assert.equal(f.workflow.getSnapshot().page, null);
  f.workflow.dispose();
});
test("canonical private report and media selection are checked before attestation", async () => {
  const f = await fixture();
  await f.workflow.read();
  const { kathaId, verifierWallet, mediaHashes, ...fields } = f.document;
  assert.equal(kathaId, f.page.kathaId);
  assert.equal(verifierWallet, f.operation.feePayer);
  assert.equal(mediaHashes.length, 1);
  await f.workflow.prepareDocument(
    { ...fields, expectedUpdatedAt: f.page.updatedAt, mediaIds: [f.page.media[0]!.id] },
    true,
  );
  assert.equal(f.workflow.getSnapshot().error, null);
  assert.equal(f.calls(), 1);
  f.page.report!.canonicalDocument += " ";
  await assert.rejects(validateConditionDocument(f.page));
  f.workflow.dispose();
});
test("private API read is authenticated, uncached and strictly parsed", async () => {
  const f = await conditionFixture();
  const api = createWalletSessionApi("http://127.0.0.1:8787", async (url, init) => {
    assert.equal(
      String(url),
      `http://127.0.0.1:8787/verifier/artworks/${f.page.kathaId}/condition`,
    );
    assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic");
    return Response.json(f.page);
  });
  assert.deepEqual(
    await api.readCondition(f.page.kathaId, "synthetic", new AbortController().signal),
    f.page,
  );
});
