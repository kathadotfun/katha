import assert from "node:assert/strict";
import { test } from "node:test";
import { verificationFixture } from "./fixtures/verification.ts";
import { createArtworkVerificationWorkflow } from "../lib/artwork-verification.ts";
import { inspectPreparedTransaction } from "../lib/prepared-transaction.ts";
import {
  createWalletSessionApi,
  WalletSessionApiError,
} from "../lib/wallet-session-api.ts";
import type { WalletSessionSnapshot } from "../lib/wallet-session.ts";
import type { WalletConnectionSnapshot } from "../lib/wallet-connection.ts";
import type {
  TransactionLifecycle,
  TransactionSnapshot,
} from "../lib/transaction-lifecycle.ts";
import { idleTransactionSnapshot } from "../lib/transaction-lifecycle.ts";
async function fixture(verifier = true) {
  const { page, operation } = await verificationFixture();
  let auth: WalletSessionSnapshot = {
    status: "signed-in",
    error: null,
    session: {
      walletId: "bbbbbbbb-1111-4111-8111-111111111111",
      walletAddress: operation.feePayer,
      cluster: "localnet",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
  };
  const listeners = new Set<() => void>();
  let flow: TransactionSnapshot = idleTransactionSnapshot;
  let preparations = 0,
    loads = 0;
  const session = {
    getSnapshot: () => auth,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    permissions: async () => ({ session: auth.session!, admin: false, verifier }),
    readVerification: async () => page,
    prepareVerification: async (
      id: string,
      input: { idempotencyKey: string; supportedTransactionVersions: (0 | 1)[] },
    ) => {
      preparations++;
      assert.equal(id, page.kathaId);
      assert.equal(
        (input as { reviewedEvidenceHash?: string }).reviewedEvidenceHash,
        page.identity!.authorshipEvidenceHash,
      );
      assert.equal(
        input.idempotencyKey,
        `verify-${auth.session!.walletId}-${page.metadata!.id}`,
      );
      assert.deepEqual(input.supportedTransactionVersions, [0, 1]);
      return operation;
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
        address: operation.feePayer,
        supportsMessageSigning: true,
        accounts: [operation.feePayer],
        supportsV0: true,
        supportsV1: true,
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
      assert.deepEqual(expected.verification, {
        authorshipEvidenceHash: page.identity!.authorshipEvidenceHash,
      });
      await inspectPreparedTransaction(input, {
        ...expected,
        cluster: "localnet",
        wallet: operation.feePayer,
      });
    },
  };
  return {
    page,
    operation,
    session,
    connection,
    transactions,
    setFlow: (value: TransactionSnapshot) => {
      flow = value;
    },
    count: () => ({ preparations, loads }),
    clear() {
      auth = { status: "signed-out", session: null, error: null };
      for (const fn of listeners) fn();
    },
  };
}
test("verification instruction is bound to reviewed evidence and the artwork PDA", async () => {
  const { page, operation } = await verificationFixture();
  const context = {
    kind: operation.kind,
    kathaId: page.kathaId,
    cluster: "localnet" as const,
    wallet: operation.feePayer,
    verification: { authorshipEvidenceHash: page.identity!.authorshipEvidenceHash },
  };
  await inspectPreparedTransaction(operation, context);
  for (const overrides of [
    { evidenceByte: 0xff },
    { verificationAddress: operation.feePayer },
    { systemProgram: operation.feePayer },
    { extraAccount: operation.feePayer },
  ]) {
    const forged = await verificationFixture(
      page.kathaId,
      operation.feePayer,
      overrides,
    );
    await assert.rejects(inspectPreparedTransaction(forged.operation, context));
  }
  await assert.rejects(
    inspectPreparedTransaction(operation, {
      ...context,
      verification: { authorshipEvidenceHash: "f".repeat(64) },
    }),
  );
  await assert.rejects(
    inspectPreparedTransaction(operation, {
      ...context,
      kathaId: "KATHA-PAUBHA-000002",
    }),
  );
});
test("manual approval, role and eligibility gates run before verification preparation", async () => {
  for (const verifier of [false, true]) {
    const f = await fixture(verifier),
      manager = createArtworkVerificationWorkflow(
        f.session,
        f.connection,
        f.transactions,
        f.page.kathaId,
      );
    await manager.read();
    await manager.prepare(false, f.page.identity!.authorshipEvidenceHash);
    assert.equal(f.count().preparations, 0);
    if (verifier) {
      for (const registration of [
        { finalized: true, unresolved: false, receipt: null },
        { finalized: false, unresolved: true, receipt: null },
      ]) {
        f.page.verification = registration;
        await manager.read();
        await manager.prepare(true, f.page.identity!.authorshipEvidenceHash);
        assert.equal(f.count().preparations, 0);
      }
      f.page.verification = { finalized: false, unresolved: false, receipt: null };
      await manager.read();
      f.setFlow({
        ...idleTransactionSnapshot,
        phase: "indexed",
        signature: "3".repeat(88),
      });
      await manager.prepare(true, f.page.identity!.authorshipEvidenceHash);
      assert.deepEqual(f.count(), { preparations: 1, loads: 1 });
      f.setFlow({
        ...idleTransactionSnapshot,
        phase: "unknown",
        signature: "3".repeat(88),
      });
      await manager.prepare(true, f.page.identity!.authorshipEvidenceHash);
      assert.equal(f.count().preparations, 1);
    } else assert.equal(manager.getSnapshot().page, null);
    manager.dispose();
  }
});
test("uncertain writes pause and pending preparations cannot activate after sign-out", async () => {
  const f = await fixture();
  const manager = createArtworkVerificationWorkflow(
    f.session,
    f.connection,
    f.transactions,
    f.page.kathaId,
  );
  await manager.read();
  f.session.prepareVerification = async () => {
    throw new WalletSessionApiError("UNAVAILABLE");
  };
  await manager.prepare(true, f.page.identity!.authorshipEvidenceHash);
  assert.equal(manager.getSnapshot().reloadRequired, true);
  await manager.prepare(true, f.page.identity!.authorshipEvidenceHash);
  assert.equal(f.count().preparations, 0);
  await manager.read();
  let finish!: (value: typeof f.operation) => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.session.prepareVerification = () =>
    new Promise((resolve) => {
      finish = resolve;
      started();
    });
  const pending = manager.prepare(true, f.page.identity!.authorshipEvidenceHash);
  await entered;
  f.clear();
  finish(f.operation);
  await pending;
  assert.equal(manager.getSnapshot().page, null);
  assert.equal(f.count().loads, 0);
  manager.dispose();
});
test("verification API requests keep bearer tokens private and reject wrong identities and versions", async () => {
  const f = await verificationFixture();
  const input = {
    authenticityConfirmed: true as const,
    reviewedEvidenceHash: f.page.identity!.authorshipEvidenceHash,
    idempotencyKey: "synthetic",
    expectedUpdatedAt: f.page.updatedAt,
    metadataVersionId: f.page.metadata!.id,
    supportedTransactionVersions: [0 as const],
  };
  const api = createWalletSessionApi("http://localhost:3001", async (_url, init) => {
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer synthetic-token",
    );
    assert.equal(init?.cache, "no-store");
    return Response.json({ ...f.operation, kathaId: "KATHA-PAUBHA-000002" });
  });
  await assert.rejects(
    api.prepareVerification(
      f.page.kathaId,
      input,
      "synthetic-token",
      new AbortController().signal,
    ),
  );
});

test("unregistered artworks and mismatched reviewed evidence cannot prepare verification", async () => {
  const f = await fixture();
  const manager = createArtworkVerificationWorkflow(
    f.session,
    f.connection,
    f.transactions,
    f.page.kathaId,
  );
  await manager.read();
  await manager.prepare(true, "f".repeat(64));
  assert.equal(f.count().preparations, 0);
  f.page.registration.finalized = false;
  await manager.read();
  await manager.prepare(true, f.page.identity!.authorshipEvidenceHash);
  assert.equal(f.count().preparations, 0);
  manager.dispose();
});
