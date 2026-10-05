import { expect, it } from "vitest";
import { unsignedOperationResponseSchema } from "@katha/shared";
import { OperationSimulationError } from "@katha/solana";
import { parseVerifyArtworkInstruction } from "@katha/solana/registry";
import { verificationFixture } from "./fixtures/verification.js";
import { createApi } from "../src/app.js";
import { createLogger } from "../src/logger.js";
import { temporaryWallet } from "./fixtures/wallet.js";

it("prepares actual generated unsigned verification and binds selected metadata without finalization", async () => {
  const f = await verificationFixture();
  const response = await f.service.prepare(
    "Bearer synthetic",
    f.snapshot.artwork.kathaId,
    f.request,
  );
  unsignedOperationResponseSchema.parse(response);
  expect(response.kind).toBe("VERIFY_ARTWORK");
  const prepared = f.simulate.mock.calls[0]![0];
  const ix = parseVerifyArtworkInstruction(prepared.instruction);
  expect(Buffer.from(ix.data.expectedAuthorshipEvidenceHash).toString("hex")).toBe(
    f.snapshot.artwork.authorshipEvidenceHash,
  );
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
  "denies unauthorized verification before reading drafts/storage/chain",
  async (bearer) => {
    const f = await verificationFixture();
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
  const f = await verificationFixture();
  f.authorities.verifierAuthority = temporaryWallet().address;
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.load).not.toHaveBeenCalled();
});
it.each([
  "artist",
  "evidence",
  "published",
  "verified",
  "stale",
  "metadata-id",
  "metadata-status",
  "metadata-missing",
  "metadata-hash",
  "metadata-identity",
])("rejects ineligible %s without persisting", async (reason) => {
  const f = await verificationFixture();
  if (reason === "artist") f.snapshot.artist!.verificationStatus = "UNVERIFIED";
  if (reason === "evidence") f.snapshot.artwork.authorshipEvidenceHash = null;
  if (reason === "published") f.snapshot.artwork.publishedAt = new Date();
  if (reason === "verified") f.snapshot.verified = true;
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
  const f = await verificationFixture();
  f.load.mockResolvedValueOnce(null);
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("rejects missing or changed local metadata bytes", async () => {
  const f = await verificationFixture();
  f.read.mockResolvedValueOnce(new Uint8Array([1]));
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.readChain).not.toHaveBeenCalled();
});
it("rejects already occupied verification PDAs and forged Registry account owners", async () => {
  const f = await verificationFixture();
  f.readChain.mockResolvedValueOnce({
    ...(await f.readChain(f.snapshot.artwork.kathaId)),
    verificationExists: true,
  });
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const read = await f.readChain(f.snapshot.artwork.kathaId);
  f.readChain.mockResolvedValueOnce({
    ...read,
    configAccount: { ...read.configAccount, programAddress: read.verificationAddress },
  });
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.save).not.toHaveBeenCalled();
});
it("does not persist failed simulations", async () => {
  const f = await verificationFixture();
  f.simulate.mockRejectedValueOnce(new OperationSimulationError("REJECTED"));
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.save).not.toHaveBeenCalled();
});
it("installs a protected strict JSON route with safe errors and no-store", async () => {
  const f = await verificationFixture();
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
    undefined,
    f.service,
  );
  const path = `/verifier/artworks/${f.snapshot.artwork.kathaId}/operations/verification`;
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
  const f = await verificationFixture();
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, {
      ...f.request,
      supportedTransactionVersions: [1],
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(f.load).not.toHaveBeenCalled();
});
it("rechecks authority if it changes after the initial snapshot read", async () => {
  const f = await verificationFixture();
  const existing = await f.readChain(f.snapshot.artwork.kathaId);
  f.readChain.mockImplementationOnce(async () => {
    f.authorities.verifierAuthority = temporaryWallet().address;
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
    const f = await verificationFixture();
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
  const { createArtworkVerification } = await import("../src/artwork-verification.js");
  const f = await verificationFixture();
  const authorization = createAuthorization(
    { authenticate: async () => f.session },
    {
      cluster: "localnet",
      adminWallets: [f.session.walletAddress],
      verifierWallets: [],
    },
    async () => f.authorities,
  );
  const service = createArtworkVerification(
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
  const f = await verificationFixture();
  f.session.cluster = "devnet";
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.load).not.toHaveBeenCalled();
});
it.each(["artist", "creator", "year", "hash", "collection", "minted", "bump"])(
  "rejects a mismatched registered %s before saving",
  async (reason) => {
    const { getArtworkRecordDecoder, getArtworkRecordEncoder } =
      await import("@katha/solana/registry");
    const f = await verificationFixture();
    const accounts = await f.readChain(f.snapshot.artwork.kathaId);
    const record = getArtworkRecordDecoder().decode(accounts.artworkAccount.data);
    const args = { ...record };
    if (reason === "artist") args.artistId = f.session.walletId;
    if (reason === "creator")
      args.creatorWallet = { __option: "Some", value: accounts.verificationAddress };
    if (reason === "year") args.creationYear = 2025;
    if (reason === "hash") args.authorshipEvidenceHash = new Uint8Array(32).fill(1);
    if (reason === "collection") args.collection = accounts.verificationAddress;
    if (reason === "minted")
      args.coreAsset = { __option: "Some", value: accounts.verificationAddress };
    if (reason === "bump") args.bump = (args.bump + 1) % 256;
    const data = new Uint8Array(246);
    data.set(getArtworkRecordEncoder().encode(args));
    f.readChain.mockResolvedValueOnce({
      ...accounts,
      artworkAccount: { ...accounts.artworkAccount, data },
    });
    await expect(
      f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.save).not.toHaveBeenCalled();
  },
);
it("requires explicit manual authenticity confirmation", async () => {
  const f = await verificationFixture();
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, {
      ...f.request,
      authenticityConfirmed: false,
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(f.load).not.toHaveBeenCalled();
});
it("leaves verification, metadata, publication and custody unchanged", async () => {
  const f = await verificationFixture();
  const before = structuredClone(f.snapshot);
  await f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request);
  expect(f.snapshot).toEqual(before);
});
it("allows an approved finalized metadata snapshot without requiring a local registration receipt", async () => {
  const f = await verificationFixture();
  f.snapshot.registered = false;
  f.snapshot.metadata!.status = "FINALIZED";
  const response = await f.service.prepare(
    "Bearer synthetic",
    f.snapshot.artwork.kathaId,
    f.request,
  );
  expect(response.kind).toBe("VERIFY_ARTWORK");
});
it("maps locked snapshot or idempotent intent conflicts without returning a transaction", async () => {
  const f = await verificationFixture();
  f.save.mockResolvedValueOnce({ status: "conflict" });
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
