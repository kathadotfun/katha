import assert from "node:assert/strict";
import { test } from "node:test";
import { registrationFixture } from "./fixtures/registration.ts";
import {
  createArtworkRegistrationWorkflow,
  validateRegistrationDocument,
} from "../lib/artwork-registration.ts";
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
async function fixture(admin = true) {
  const { page, operation } = await registrationFixture();
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
    permissions: async () => ({ session: auth.session!, admin, verifier: false }),
    readRegistration: async () => page,
    prepareMetadata: async () => ({
      ...page.metadata!,
      kathaId: page.kathaId,
      status: "PREPARED" as const,
    }),
    prepareRegistration: async (
      id: string,
      input: { idempotencyKey: string; supportedTransactionVersions: (0 | 1)[] },
    ) => {
      preparations++;
      assert.equal(id, page.kathaId);
      assert.equal(
        input.idempotencyKey,
        `register-${auth.session!.walletId}-${page.metadata!.id}`,
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
      assert.deepEqual(expected.registration, page.identity);
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
test("registration verifies exact public bytes and binds every immutable instruction field", async () => {
  const { page, operation } = await registrationFixture();
  await validateRegistrationDocument(page);
  const context = {
    kind: operation.kind,
    kathaId: page.kathaId,
    cluster: "localnet" as const,
    wallet: operation.feePayer,
    registration: page.identity!,
  };
  await inspectPreparedTransaction(operation, context);
  for (const patch of [
    { artistId: "bbbbbbbb-1111-4111-8111-111111111111" },
    { creatorWallet: "11111111111111111111111111111111" },
    { category: "THANGKA" as const },
    { creationYear: 2025 },
    { authorshipEvidenceHash: "f".repeat(64) },
  ])
    await assert.rejects(
      inspectPreparedTransaction(operation, {
        ...context,
        registration: { ...page.identity!, ...patch },
      }),
    );
  await assert.rejects(
    validateRegistrationDocument({
      ...page,
      metadata: {
        ...page.metadata!,
        canonicalDocument: page.metadata!.canonicalDocument + " ",
      },
    }),
  );
  await assert.rejects(
    validateRegistrationDocument({ ...page, title: "Forged title" }),
  );
});
test("explicit document review, role and eligibility gates run before registration preparation", async () => {
  for (const admin of [false, true]) {
    const f = await fixture(admin),
      manager = createArtworkRegistrationWorkflow(
        f.session,
        f.connection,
        f.transactions,
        f.page.kathaId,
      );
    await manager.read();
    await manager.prepare(false);
    assert.equal(f.count().preparations, 0);
    if (admin) {
      for (const registration of [
        { finalized: true, unresolved: false, receipt: null },
        { finalized: false, unresolved: true, receipt: null },
      ]) {
        f.page.registration = registration;
        await manager.read();
        await manager.prepare(true);
        assert.equal(f.count().preparations, 0);
      }
      f.page.registration = { finalized: false, unresolved: false, receipt: null };
      await manager.read();
      await manager.prepare(true);
      assert.deepEqual(f.count(), { preparations: 1, loads: 1 });
      f.setFlow({
        ...idleTransactionSnapshot,
        phase: "unknown",
        signature: "3".repeat(88),
      });
      await manager.prepare(true);
      assert.equal(f.count().preparations, 1);
    } else assert.equal(manager.getSnapshot().page, null);
    manager.dispose();
  }
});
test("uncertain writes pause and pending preparations cannot activate after sign-out", async () => {
  const f = await fixture();
  const manager = createArtworkRegistrationWorkflow(
    f.session,
    f.connection,
    f.transactions,
    f.page.kathaId,
  );
  await manager.read();
  f.session.prepareRegistration = async () => {
    throw new WalletSessionApiError("UNAVAILABLE");
  };
  await manager.prepare(true);
  assert.equal(manager.getSnapshot().reloadRequired, true);
  assert.match(manager.getSnapshot().error!, /temporarily unavailable/);
  assert.equal(manager.getSnapshot().page?.kathaId, f.page.kathaId);
  await manager.prepare(true);
  assert.equal(f.count().preparations, 0);
  await manager.read();
  let finish!: (value: typeof f.operation) => void;
  let entered!: () => void;
  const preparationStarted = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.session.prepareRegistration = () =>
    new Promise((resolve) => {
      finish = resolve;
      entered();
    });
  const pending = manager.prepare(true);
  await preparationStarted;
  f.clear();
  finish(f.operation);
  await pending;
  assert.equal(manager.getSnapshot().page, null);
  assert.equal(f.count().loads, 0);
  manager.dispose();
});
test("registration API requests keep bearer tokens private and reject wrong identities and versions", async () => {
  const f = await registrationFixture();
  const input = {
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
    api.prepareRegistration(
      f.page.kathaId,
      input,
      "synthetic-token",
      new AbortController().signal,
    ),
  );
});

test("metadata preparation reloads and verifies the exact saved version before review", async () => {
  const f = await fixture();
  const metadata = f.page.metadata!;
  f.page.metadata = null;
  let documents = 0;
  f.session.prepareMetadata = async () => {
    documents++;
    f.page.metadata = metadata;
    return { ...metadata, kathaId: f.page.kathaId, status: "PREPARED" as const };
  };
  const manager = createArtworkRegistrationWorkflow(
    f.session,
    f.connection,
    f.transactions,
    f.page.kathaId,
  );
  await manager.read();
  await manager.prepareMetadata();
  assert.equal(documents, 1);
  assert.equal(manager.getSnapshot().page?.metadata?.id, metadata.id);
  assert.equal(f.count().preparations, 0);
  await manager.prepareMetadata();
  assert.equal(documents, 1);
  manager.dispose();
});
