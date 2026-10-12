import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { ArtworkWorkflowStore } from "@katha/db";
import { artworkWorkflowResponseSchema, type WalletSession } from "@katha/shared";
import { createApi } from "../src/app.js";
import { createArtworkWorkflow } from "../src/artwork-workflow.js";
import { createAuthorization } from "../src/authorization.js";
import { createLogger } from "../src/logger.js";
import { DomainError } from "../src/errors.js";
import { temporaryWallet } from "./fixtures/wallet.js";

type Facts = NonNullable<Awaited<ReturnType<ArtworkWorkflowStore["read"]>>>;
function fixture(facts: Facts | null) {
  const store: ArtworkWorkflowStore = {
    read: vi.fn<ArtworkWorkflowStore["read"]>(async () => facts),
  };
  const admin = temporaryWallet().address;
  const verifier = temporaryWallet().address;
  const session: WalletSession = {
    walletId: randomUUID(),
    walletAddress: admin,
    cluster: "localnet",
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const authorization = createAuthorization(
    {
      authenticate: async (header) => {
        if (header === "Bearer admin") return session;
        if (header === "Bearer verifier")
          return { ...session, walletAddress: verifier };
        if (header === "Bearer outsider")
          return { ...session, walletAddress: temporaryWallet().address };
        throw new DomainError("UNAUTHENTICATED");
      },
    },
    { cluster: "localnet", adminWallets: [admin], verifierWallets: [verifier] },
    async () => {
      throw new Error("No chain reads for workflow markers");
    },
  );
  const app = createApi(
    createLogger(() => {}),
    undefined,
    [],
    undefined,
    authorization,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    createArtworkWorkflow(store),
  );
  const get = (path: string, token?: string) =>
    app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { store, get };
}
const blank: Facts = {
  hasEvidence: false,
  published: false,
  media: { any: false, publicHero: false },
  hasMetadataDocument: false,
  operations: {},
};
const path = "/admin/artworks/KATHA-PAUBHA-000001/workflow";

it("marks a fresh draft as documentation in progress and everything else not started", async () => {
  const f = fixture(blank);
  const result = await f.get(path, "admin");
  expect(result.status).toBe(200);
  expect(result.headers.get("Cache-Control")).toBe("no-store");
  expect(artworkWorkflowResponseSchema.parse(await result.json()).steps).toEqual({
    documentation: "PENDING",
    registration: "NOT_STARTED",
    verification: "NOT_STARTED",
    condition: "NOT_STARTED",
    custody: "NOT_STARTED",
    media: "NOT_STARTED",
    minting: "NOT_STARTED",
    metadata: "NOT_STARTED",
  });
});
it("derives complete and pending markers from finalized and open records only", async () => {
  const f = fixture({
    hasEvidence: true,
    published: false,
    media: { any: true, publicHero: true },
    hasMetadataDocument: true,
    operations: {
      REGISTER_ARTWORK: { finalized: true, open: false },
      VERIFY_ARTWORK: { finalized: false, open: true },
      // A failed attempt alone doesn't count as started work.
      RECORD_CONDITION: { finalized: false, open: false },
      MINT_ARTWORK: { finalized: true, open: false },
      REVISE_METADATA: { finalized: true, open: true },
    },
  });
  const body = artworkWorkflowResponseSchema.parse(
    await (await f.get(path.replace("/admin/", "/verifier/"), "verifier")).json(),
  );
  expect(body.minted).toBe(true);
  expect(body.published).toBe(false);
  expect(body.steps).toEqual({
    documentation: "COMPLETE",
    registration: "COMPLETE",
    verification: "PENDING",
    condition: "NOT_STARTED",
    custody: "NOT_STARTED",
    media: "COMPLETE",
    // Minted but not published is still in progress on the minting page.
    minting: "PENDING",
    metadata: "COMPLETE",
  });
});
it("a prepared metadata document marks registration started before any transaction", async () => {
  const f = fixture({
    ...blank,
    hasMetadataDocument: true,
    media: { any: true, publicHero: false },
  });
  const body = artworkWorkflowResponseSchema.parse(
    await (await f.get(path, "admin")).json(),
  );
  expect(body.steps.registration).toBe("PENDING");
  expect(body.steps.media).toBe("PENDING");
});
it("denies anonymous and unprivileged sessions before reading, and validates the ID", async () => {
  const f = fixture(blank);
  expect((await f.get(path)).status).toBe(401);
  expect((await f.get(path, "outsider")).status).toBe(403);
  expect((await f.get(path, "verifier")).status).toBe(403);
  expect(f.store.read).not.toHaveBeenCalled();
  expect((await f.get("/admin/artworks/invalid/workflow", "admin")).status).toBe(400);
  expect((await f.get(`${path}?x=1`, "admin")).status).toBe(400);
  const missing = fixture(null);
  expect((await missing.get(path, "admin")).status).toBe(404);
});
