import { expect, it } from "vitest";
import { unsignedOperationResponseSchema } from "@katha/shared";
import { OperationSimulationError } from "@katha/solana";
import { parseRegisterArtworkInstruction } from "@katha/solana/registry";
import { registrationFixture } from "./fixtures/registration.js";
import { createApi } from "../src/app.js";
import { createLogger } from "../src/logger.js";
import { temporaryWallet } from "./fixtures/wallet.js";

it("prepares actual generated unsigned registration and binds selected metadata without finalization", async () => {
  const f = await registrationFixture();
  const response = await f.service.prepare(
    "Bearer synthetic",
    f.snapshot.artwork.kathaId,
    f.request,
  );
  unsignedOperationResponseSchema.parse(response);
  expect(response.kind).toBe("REGISTER_ARTWORK");
  const prepared = f.simulate.mock.calls[0]![0];
  const ix = parseRegisterArtworkInstruction(prepared.instruction);
  expect(ix.data.kathaId).toBe(f.snapshot.artwork.kathaId);
  expect(ix.data.artistId).toBe(f.snapshot.artwork.artistId);
  expect(ix.data.creatorWallet).toEqual({ __option: "None" });
  const [operation, , , artifact] = f.save.mock.calls[0]!;
  expect(operation.expectedHashes).toContain(f.snapshot.metadata!.documentHash);
  expect(operation.expectedHashes).toContain(f.snapshot.artwork.authorshipEvidenceHash);
  expect(JSON.parse(artifact.canonicalRequest).parameters).toMatchObject({
    metadataVersionId: f.request.metadataVersionId,
    metadataHash: f.snapshot.metadata!.documentHash,
    expectedUpdatedAt: f.request.expectedUpdatedAt,
  });
  expect(JSON.stringify(response)).not.toContain("PRIVATE ARTIST BIO");
  expect(response).not.toHaveProperty("canonicalRequest");
  expect(f.read).toHaveBeenCalledOnce();
  expect(f.readAuthorities).toHaveBeenCalledTimes(2);
});
it.each([undefined, "Bearer outsider"])(
  "denies unauthorized registration before reading drafts/storage/chain",
  async (bearer) => {
    const f = await registrationFixture();
    await expect(
      f.service.prepare(bearer, f.snapshot.artwork.kathaId, f.request),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(f.load).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
    expect(f.readChain).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  },
);
it("denies a removed on-chain authority before reading draft content", async () => {
  const f = await registrationFixture();
  f.authorities.registrationAuthority = temporaryWallet().address;
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.load).not.toHaveBeenCalled();
});
it.each([
  "artist",
  "evidence",
  "published",
  "registered",
  "stale",
  "metadata-id",
  "metadata-status",
  "metadata-missing",
  "metadata-hash",
  "metadata-identity",
])("rejects ineligible %s without persisting", async (reason) => {
  const f = await registrationFixture();
  if (reason === "artist") f.snapshot.artist!.verificationStatus = "UNVERIFIED";
  if (reason === "evidence") f.snapshot.artwork.authorshipEvidenceHash = null;
  if (reason === "published") f.snapshot.artwork.publishedAt = new Date();
  if (reason === "registered") f.snapshot.registered = true;
  if (reason === "stale") f.request.expectedUpdatedAt = "2026-10-04T00:00:00.000Z";
  if (reason === "metadata-id") f.request.metadataVersionId = f.snapshot.artwork.id;
  if (reason === "metadata-status") f.snapshot.metadata!.status = "DRAFT";
  if (reason === "metadata-missing") f.snapshot.metadata = null;
  if (reason === "metadata-hash") f.snapshot.metadata!.documentHash = "b".repeat(64);
  if (reason === "metadata-identity") f.snapshot.artwork.category = "THANGKA";
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.save).not.toHaveBeenCalled();
});
it("returns NOT_FOUND for a missing draft", async () => {
  const f = await registrationFixture();
  f.load.mockResolvedValueOnce(null);
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("rejects missing or changed local metadata bytes", async () => {
  const f = await registrationFixture();
  f.read.mockResolvedValueOnce(new Uint8Array([1]));
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.readChain).not.toHaveBeenCalled();
});
it("rejects already occupied artwork PDAs and forged Registry account owners", async () => {
  const f = await registrationFixture();
  f.readChain.mockResolvedValueOnce({
    ...(await f.readChain(f.snapshot.artwork.kathaId)),
    artworkExists: true,
  });
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const read = await f.readChain(f.snapshot.artwork.kathaId);
  f.readChain.mockResolvedValueOnce({
    ...read,
    configAccount: { ...read.configAccount, programAddress: read.artworkAddress },
  });
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.save).not.toHaveBeenCalled();
});
it("does not persist failed simulations", async () => {
  const f = await registrationFixture();
  f.simulate.mockRejectedValueOnce(new OperationSimulationError("REJECTED"));
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.save).not.toHaveBeenCalled();
});
it("installs a protected strict JSON route with safe errors and no-store", async () => {
  const f = await registrationFixture();
  const logs: string[] = [];
  const app = createApi(
    createLogger((line) => logs.push(line)),
    undefined,
    [],
    undefined,
    f.authorization,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    f.service,
  );
  const path = `/admin/artworks/${f.snapshot.artwork.kathaId}/operations/registration`;
  const send = (body: unknown = f.request, auth = "Bearer synthetic", suffix = "") =>
    app.request(path + suffix, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(body),
    });
  const success = await send();
  expect(success.status).toBe(201);
  unsignedOperationResponseSchema.parse(await success.json());
  expect(success.headers.get("Cache-Control")).toBe("no-store");
  expect((await send(f.request, "Bearer outsider")).status).toBe(401);
  expect((await send({ ...f.request, metadataHash: "client hash" })).status).toBe(400);
  expect((await send(f.request, "Bearer synthetic", "?cluster=devnet")).status).toBe(
    400,
  );
  f.readChain.mockRejectedValueOnce(new Error("PRIVATE RPC ERROR"));
  const failed = await send();
  expect(failed.status).toBe(500);
  expect(await failed.text()).not.toContain("PRIVATE RPC ERROR");
  expect(logs.join("")).not.toContain("PRIVATE RPC ERROR");
});
it("rejects localnet v1-only wallets before loading the draft", async () => {
  const f = await registrationFixture();
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, {
      ...f.request,
      supportedTransactionVersions: [1],
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(f.load).not.toHaveBeenCalled();
});
it("rechecks authority if it changes after the initial snapshot read", async () => {
  const f = await registrationFixture();
  const existing = await f.readChain(f.snapshot.artwork.kathaId);
  f.readChain.mockImplementationOnce(async () => {
    f.authorities.registrationAuthority = temporaryWallet().address;
    return existing;
  });
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.save).not.toHaveBeenCalled();
});
it.each(["NOT_FOUND", "INTEGRITY_FAILURE"] as const)(
  "rejects approved storage %s before chain/persistence",
  async (code) => {
    const { StorageError } = await import("../src/storage.js");
    const f = await registrationFixture();
    f.read.mockRejectedValueOnce(new StorageError(code));
    await expect(
      f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.readChain).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  },
);
it("requires both administrative allowlist and Registry role before reading the draft", async () => {
  const { createAuthorization } = await import("../src/authorization.js");
  const { createArtworkRegistration } = await import("../src/artwork-registration.js");
  const f = await registrationFixture();
  const authorization = createAuthorization(
    { authenticate: async () => f.session },
    {
      cluster: "localnet",
      adminWallets: [],
      verifierWallets: [f.session.walletAddress],
    },
    async () => f.authorities,
  );
  const service = createArtworkRegistration(
    f.store,
    authorization,
    f.readChain,
    f.chain,
    f.storage,
    "localnet",
  );
  await expect(
    service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.load).not.toHaveBeenCalled();
});
it("rejects a session from another cluster before reading the draft", async () => {
  const f = await registrationFixture();
  f.session.cluster = "devnet";
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.load).not.toHaveBeenCalled();
});
