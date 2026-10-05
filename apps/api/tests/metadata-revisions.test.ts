import { expect, it } from "vitest";
import {
  canonicalDocumentBytes,
  sha256Hex,
  unsignedOperationResponseSchema,
} from "@katha/shared";
import {
  getArtworkRecordDecoder,
  getArtworkRecordEncoder,
  getMetadataHeadDecoder,
  getMetadataHeadEncoder,
  getMetadataRevisionDecoder,
  getMetadataRevisionEncoder,
  parseInitializeMetadataInstruction,
  parseReviseUnmintedMetadataInstruction,
  parseReviseMintedMetadataInstruction,
} from "@katha/solana/registry";
import { metadataRevisionFixture } from "./fixtures/metadata-revision.js";
import { temporaryWallet } from "./fixtures/wallet.js";
import { createApi } from "../src/app.js";

it.each(["INITIALIZE", "UNMINTED", "MINTED"] as const)(
  "prepares %s without changing history or authorship",
  async (mode) => {
    const f = await metadataRevisionFixture(mode);
    const before = structuredClone(f.snapshot);
    unsignedOperationResponseSchema.parse(
      await f.service.prepare(
        "Bearer synthetic",
        f.snapshot.artwork.kathaId,
        f.request,
      ),
    );
    const raw = f.simulate.mock.calls[0]![0].instruction;
    const instruction =
      mode === "INITIALIZE"
        ? parseInitializeMetadataInstruction(raw)
        : mode === "MINTED"
          ? parseReviseMintedMetadataInstruction(raw)
          : parseReviseUnmintedMetadataInstruction(raw);
    expect(Buffer.from(instruction.data.documentHash).toString("hex")).toBe(f.hash);
    expect(instruction.data.uri).toBe(f.snapshot.metadata!.uri);
    expect(f.save.mock.calls[0]![0].kind).toBe("REVISE_METADATA");
    expect(f.save.mock.calls[0]![3].canonicalRequest).not.toContain(f.document.notes);
    expect(f.snapshot).toEqual(before);
  },
);
it("requires live registration authority before private reads", async () => {
  const f = await metadataRevisionFixture();
  f.authorities.registrationAuthority = temporaryWallet().address;
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.load).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
});
it("rejects anonymous preparation before database or RPC reads", async () => {
  const f = await metadataRevisionFixture();
  await expect(
    f.service.prepare(undefined, f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(f.load).not.toHaveBeenCalled();
  expect(f.readChain).not.toHaveBeenCalled();
});
it.each([
  "timestamp",
  "metadata-id",
  "draft",
  "finalized",
  "artist",
  "hash",
  "storage",
  "version",
  "current-hash",
  "identity",
  "simulation",
  "save-race",
  "no-op",
  "wrong-cluster",
  "missing-local",
])("rejects %s without persistence", async (reason) => {
  const f = await metadataRevisionFixture();
  if (reason === "timestamp") f.request.expectedUpdatedAt = "2026-10-04T00:00:00.000Z";
  if (reason === "metadata-id")
    f.request.metadataVersionId = "11111111-1111-4111-8111-111111111111";
  if (reason === "draft") f.snapshot.metadata!.status = "DRAFT";
  if (reason === "finalized") f.snapshot.metadata!.status = "FINALIZED";
  if (reason === "artist") f.snapshot.artist!.verificationStatus = "UNVERIFIED";
  if (reason === "hash") f.snapshot.metadata!.documentHash = "a".repeat(64);
  if (reason === "storage") f.read.mockResolvedValueOnce(new Uint8Array([1]));
  if (reason === "version") f.request.expectedMetadataVersion = 2;
  if (reason === "current-hash") f.request.expectedMetadataHash = "b".repeat(64);
  if (reason === "identity") {
    const data = new Uint8Array(246);
    data.set(
      getArtworkRecordEncoder().encode({
        ...getArtworkRecordDecoder().decode(f.accounts.artworkAccount.data),
        creationYear: 2025,
      }),
    );
    f.accounts.artworkAccount = { ...f.accounts.artworkAccount, data };
  }
  if (reason === "simulation")
    f.simulate.mockRejectedValueOnce(new Error("private rpc"));
  if (reason === "save-race") f.save.mockResolvedValueOnce({ status: "conflict" });
  if (reason === "no-op" && f.accounts.mode !== "INITIALIZE") {
    f.request.expectedMetadataHash = f.hash;
    const revisionData = new Uint8Array(321);
    revisionData.set(
      getMetadataRevisionEncoder().encode({
        ...getMetadataRevisionDecoder().decode(f.accounts.currentRevisionAccount.data),
        documentHash: Uint8Array.from(Buffer.from(f.hash, "hex")),
        uri: f.snapshot.metadata!.uri!,
      }),
    );
    f.accounts.currentRevisionAccount = {
      ...f.accounts.currentRevisionAccount,
      data: revisionData,
    };
    f.accounts.metadataHeadAccount = {
      ...f.accounts.metadataHeadAccount,
      data: Uint8Array.from(
        getMetadataHeadEncoder().encode({
          ...getMetadataHeadDecoder().decode(f.accounts.metadataHeadAccount.data),
          currentHash: Uint8Array.from(Buffer.from(f.hash, "hex")),
        }),
      ),
    };
  }
  if (reason === "wrong-cluster") f.session.cluster = "devnet";
  if (reason === "missing-local") f.load.mockResolvedValueOnce(null);
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toThrow();
  if (reason !== "save-race") expect(f.save).not.toHaveBeenCalled();
});
it("rejects a self-consistent replacement of immutable attribution", async () => {
  const f = await metadataRevisionFixture();
  const document = JSON.parse(f.snapshot.metadata!.canonicalDocument!);
  // Use a valid different UUID so integrity, not document syntax, rejects the replacement.
  document.artist.artistId = "11111111-1111-4111-8111-111111111111";
  const bytes = canonicalDocumentBytes(document);
  f.snapshot.metadata!.canonicalDocument = new TextDecoder().decode(bytes);
  f.snapshot.metadata!.documentHash = await sha256Hex(bytes);
  f.read.mockResolvedValueOnce(bytes);
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.save).not.toHaveBeenCalled();
});
it("installs strict no-store metadata route and redacts RPC failures", async () => {
  const f = await metadataRevisionFixture();
  const app = createApi(
    undefined,
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
    undefined,
    undefined,
    undefined,
    undefined,
    f.service,
  );
  const send = (body: unknown = f.request, suffix = "", bearer = "Bearer synthetic") =>
    app.request(
      `/admin/artworks/${f.snapshot.artwork.kathaId}/operations/metadata${suffix}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: bearer },
        body: JSON.stringify(body),
      },
    );
  const success = await send();
  expect(success.status).toBe(201);
  expect(success.headers.get("Cache-Control")).toBe("no-store");
  expect((await send({ ...f.request, uri: "http://private" })).status).toBe(400);
  expect((await send(f.request, "?revision=2")).status).toBe(400);
  expect((await send(f.request, "", "")).status).toBe(401);
  f.readChain.mockRejectedValueOnce(new Error("PRIVATE RPC DATA"));
  const error = await send();
  expect(error.status).toBe(500);
  expect(await error.text()).not.toContain("PRIVATE RPC DATA");
});

it.each([
  "core-owner",
  "core-collection",
  "core-uri",
  "collection-authority",
  "head-owner",
  "revision-owner",
])("rejects minted %s before simulation", async (reason) => {
  const f = await metadataRevisionFixture("MINTED");
  if (f.accounts.mode !== "MINTED") throw new Error("Fixture missing");
  if (reason === "core-owner")
    f.accounts.assetAccount = {
      ...f.accounts.assetAccount,
      programAddress: f.accounts.artworkAccount.programAddress,
    };
  if (reason === "core-collection" || reason === "core-uri") {
    const data = Uint8Array.from(f.accounts.assetAccount.data);
    if (reason === "core-collection") data[34] = data[34]! ^ 1;
    else data[data.length - 2] = data[data.length - 2]! ^ 1;
    f.accounts.assetAccount = { ...f.accounts.assetAccount, data };
  }
  if (reason === "collection-authority") {
    const data = Uint8Array.from(f.accounts.collectionAccount.data);
    data[1] = data[1]! ^ 1;
    f.accounts.collectionAccount = { ...f.accounts.collectionAccount, data };
  }
  if (reason === "head-owner")
    f.accounts.metadataHeadAccount = {
      ...f.accounts.metadataHeadAccount,
      programAddress: f.accounts.assetAccount.programAddress,
    };
  if (reason === "revision-owner")
    f.accounts.currentRevisionAccount = {
      ...f.accounts.currentRevisionAccount,
      programAddress: f.accounts.assetAccount.programAddress,
    };
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.simulate).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});
it("rejects a reviewed revision when the metadata head does not exist", async () => {
  const f = await metadataRevisionFixture("INITIALIZE");
  f.request.expectedMetadataVersion = 1;
  f.request.expectedMetadataHash = f.oldHash;
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.save).not.toHaveBeenCalled();
});
