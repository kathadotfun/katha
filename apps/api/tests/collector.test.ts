import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { CollectorStore } from "@katha/db";
import { collectorCollectionQuerySchema } from "@katha/shared";
import { CORE_PROGRAM_ADDRESS } from "@katha/solana";
import { KATHA_MARKETPLACE_PROGRAM_ADDRESS } from "@katha/solana/marketplace";
import {
  KATHA_REGISTRY_PROGRAM_ADDRESS,
  findArtworkPda,
  findAssetPda,
} from "@katha/solana/registry";
import { createCollector } from "../src/collector.js";
import { createApi } from "../src/app.js";
import { createLogger } from "../src/logger.js";
import { DomainError } from "../src/errors.js";
import type { WalletSessionBoundary } from "../src/wallet-session.js";
async function setup() {
  const now = new Date(),
    id = randomUUID(),
    kathaId = "KATHA-PAUBHA-000001";
  const [artwork] = await findArtworkPda({ kathaId }),
    [asset] = await findAssetPda({ artwork });
  const programs = {
    registry: KATHA_REGISTRY_PROGRAM_ADDRESS,
    core: CORE_PROGRAM_ADDRESS,
    marketplace: KATHA_MARKETPLACE_PROGRAM_ADDRESS,
  };
  const session = {
    walletId: randomUUID(),
    walletAddress: CORE_PROGRAM_ADDRESS,
    cluster: "localnet" as const,
    expiresAt: new Date(now.getTime() + 60000).toISOString(),
  };
  const event = {
    id: randomUUID(),
    cluster: "LOCALNET" as const,
    programAddress: programs.registry,
    signature: "1".repeat(64),
    slot: 1n,
    transactionIndex: 0,
    outerInstructionIndex: 0,
    innerInstructionIndex: -1,
    eventIndex: 0,
    kind: "OWNERSHIP" as const,
    artworkId: id,
    assetAddress: asset,
    payload: { artwork, ownerWallet: session.walletAddress, collection: asset },
    chainRecordedAt: now,
    indexedAt: now,
  };
  const owner = {
    cluster: "LOCALNET" as const,
    artworkId: id,
    assetAddress: asset,
    sourceEventId: event.id,
    ownerWallet: session.walletAddress,
  };
  const snapshot: Awaited<ReturnType<CollectorStore["collection"]>> = {
    evaluatedAt: now,
    items: [
      {
        artwork: {
          kathaId,
          title: "Synthetic Paubha",
          category: "PAUBHA",
          creationYear: 2026,
        },
        artist: {
          id: randomUUID(),
          slug: "synthetic-artist",
          displayName: "Synthetic",
        },
        heroImage: null,
        owner,
        ownershipEvent: event,
        registration: {
          ...event,
          payload: { ...event.payload, name: "ArtworkRegistered" },
        },
        mint: { ...event, payload: { ...event.payload, name: "ArtworkMinted" } },
        custody: { ...event, payload: { name: "CustodyUpdated", toState: 1 } },
        reconciliation: {
          cluster: "LOCALNET",
          artworkId: id,
          sourceEventId: event.id,
          indexedOwner: session.walletAddress,
          observedOwner: session.walletAddress,
          observedSlot: 1n,
          status: "MATCH",
          checkedAt: now,
        },
        network: {
          cluster: "LOCALNET",
          registryProgram: programs.registry,
          collection: asset,
          genesisHash: asset,
          finalizedSlot: 1n,
          blocked: false,
          updatedAt: now,
        },
        checkpoints: Object.values(programs).map((programAddress) => ({
          cluster: "LOCALNET" as const,
          programAddress,
          fromSlot: 0n,
          scannedThroughSlot: 1n,
          lastSignature: "1".repeat(64),
          lastSignatureSlot: 1n,
          gapReason: null,
          gapFromSlot: null,
          gapThroughSlot: null,
          updatedAt: now,
        })),
        evaluatedAt: now,
        programs,
      },
    ],
  };
  const sessions = {
    authenticate: vi.fn<WalletSessionBoundary["authenticate"]>(
      async (header: string | undefined) => {
        if (header !== "Bearer synthetic") throw new DomainError("UNAUTHENTICATED");
        return session;
      },
    ),
    challenge: vi.fn(),
    verify: vi.fn(),
    logout: vi.fn(),
  } satisfies WalletSessionBoundary;
  const store = {
    account: vi.fn(async () => ({ indexedArtworkCount: 1, evaluatedAt: now })),
    collection: vi.fn(async () => snapshot),
  } satisfies CollectorStore;
  const collector = createCollector(store, sessions, "localnet");
  const args: Parameters<typeof createApi> = [];
  args[0] = createLogger(() => {});
  args[3] = sessions;
  args[24] = collector;
  return { store, sessions, session, snapshot, collector, app: createApi(...args) };
}
it("scopes account and collection to the authenticated wallet and exposes safe custody/indexing", async () => {
  const f = await setup();
  const result = await f.collector.collection("Bearer synthetic", {
    limit: 20,
    offset: 0,
  });
  expect(f.store.collection).toHaveBeenCalledWith(f.session.walletAddress, {
    limit: 20,
    offset: 0,
  });
  expect(result.items[0]).toMatchObject({
    ownerWallet: f.session.walletAddress,
    custody: { state: "KATHA_HELD", source: "FINALIZED_REGISTRY", heldByViewer: false },
    indexing: { status: "AT_OBSERVED_HEAD", ownerCheck: { status: "MATCH" } },
  });
  expect(await f.collector.account("Bearer synthetic")).toMatchObject({
    session: f.session,
    indexedArtworkCount: 1,
  });
});
it("separates owning the asset from physically holding the work", async () => {
  const f = await setup();
  const item = f.snapshot.items[0]!;
  const held = (subject: string) => ({
    ...item.custody!,
    payload: {
      name: "CustodyUpdated",
      toState: 2,
      toSubject: { __option: "Some", value: subject },
    },
  });
  item.custody = held(f.session.walletAddress);
  expect(
    (await f.collector.collection("Bearer synthetic", { limit: 20, offset: 0 }))
      .items[0]!.custody,
  ).toMatchObject({ state: "COLLECTOR_HELD", heldByViewer: true });
  // The owner of the asset is not the custodian when another wallet holds the work.
  item.custody = held("EH2PR6WDVC4U6bDAVKVS4wuSofwNi5cY9fCxU2snv5kn");
  expect(
    (await f.collector.collection("Bearer synthetic", { limit: 20, offset: 0 }))
      .items[0]!.custody,
  ).toMatchObject({ state: "COLLECTOR_HELD", heldByViewer: false });
});
it.each(["missing", "expired", "revoked", "wrong cluster"])(
  "rejects %s session before reading holdings",
  async (kind) => {
    const f = await setup();
    if (kind === "wrong cluster")
      f.sessions.authenticate.mockResolvedValue({ ...f.session, cluster: "devnet" });
    else f.sessions.authenticate.mockRejectedValue(new DomainError("UNAUTHENTICATED"));
    await expect(
      f.collector.collection(undefined, { limit: 20, offset: 0 }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(f.store.collection).not.toHaveBeenCalled();
    await expect(f.collector.account(undefined)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(f.store.account).not.toHaveBeenCalled();
  },
);
it.each(["wallet", "asset", "mint", "collection", "source owner"])(
  "rejects mismatched %s holding bindings",
  async (kind) => {
    const f = await setup(),
      item = f.snapshot.items[0]!;
    if (kind === "wallet") item.owner.ownerWallet = KATHA_REGISTRY_PROGRAM_ADDRESS;
    if (kind === "asset") item.owner.assetAddress = CORE_PROGRAM_ADDRESS;
    if (kind === "mint") item.mint = null;
    if (kind === "collection") item.mint!.payload.collection = CORE_PROGRAM_ADDRESS;
    if (kind === "source owner")
      item.ownershipEvent.payload.ownerWallet = KATHA_REGISTRY_PROGRAM_ADDRESS;
    await expect(
      f.collector.collection("Bearer synthetic", { limit: 20, offset: 0 }),
    ).rejects.toThrow("holding binding");
  },
);
it.each(["lag", "gap", "stale", "changed source", "mismatch"])(
  "reports %s reconciliation without changing custody",
  async (kind) => {
    const f = await setup(),
      item = f.snapshot.items[0]!;
    if (kind === "lag") item.checkpoints[0]!.scannedThroughSlot = 0n;
    if (kind === "gap") {
      item.checkpoints[0]!.gapFromSlot = 0n;
      item.checkpoints[0]!.gapThroughSlot = 1n;
      item.checkpoints[0]!.gapReason = "EVIDENCE_INVALID";
    }
    if (kind === "stale") item.reconciliation!.checkedAt = new Date(0);
    if (kind === "changed source") item.reconciliation!.sourceEventId = randomUUID();
    if (kind === "mismatch") {
      item.reconciliation!.status = "MISMATCH";
      item.reconciliation!.observedOwner = KATHA_REGISTRY_PROGRAM_ADDRESS;
    }
    const result = await f.collector.collection("Bearer synthetic", {
      limit: 20,
      offset: 0,
    });
    expect(result.items[0]!.indexing.status).toBe(
      kind === "lag"
        ? "LAGGING"
        : kind === "gap" || kind === "mismatch"
          ? "GAP_DETECTED"
          : "STALE",
    );
    expect(result.items[0]!.custody.state).toBe("KATHA_HELD");
  },
);
it("keeps responses and auth errors noncached, validates pagination and disallows wallet overrides", async () => {
  const f = await setup();
  for (const path of ["/account", "/account/collection"]) {
    const denied = await f.app.request(path);
    expect(denied.status).toBe(401);
    expect(denied.headers.get("Cache-Control")).toBe("no-store");
    const ok = await f.app.request(path, {
      headers: { Authorization: "Bearer synthetic" },
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toBe("no-store");
  }
  for (const query of [
    "walletAddress=other",
    "limit=101",
    "limit=1&limit=2",
    "offset=-1",
  ]) {
    const result = await f.app.request(`/account/collection?${query}`, {
      headers: { Authorization: "Bearer synthetic" },
    });
    expect(result.status).toBe(400);
  }
  expect(collectorCollectionQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
});
it("returns bounded and empty pages and never serializes private store fields", async () => {
  const f = await setup();
  Object.assign(f.snapshot.items[0]!, {
    fulfillment: { address: "PRIVATE SHIPPING" },
    privateEvidence: "PRIVATE EVIDENCE",
  });
  expect(
    JSON.stringify(
      await f.collector.collection("Bearer synthetic", { limit: 1, offset: 0 }),
    ),
  ).not.toContain("PRIVATE");
  f.snapshot.items.push(f.snapshot.items[0]!);
  const page = await f.collector.collection("Bearer synthetic", {
    limit: 1,
    offset: 0,
  });
  expect(page.items).toHaveLength(1);
  expect(page.pagination.hasMore).toBe(true);
  f.snapshot.items = [];
  expect(
    (await f.collector.collection("Bearer synthetic", { limit: 1, offset: 1 })).items,
  ).toEqual([]);
});
