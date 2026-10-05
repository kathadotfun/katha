import { expect, it } from "vitest";
import { mintFixture } from "./fixtures/minting.js";
import {
  getArtworkRecordDecoder,
  getArtworkRecordEncoder,
  getCustodyHeadDecoder,
  getCustodyHeadEncoder,
  CustodyState,
  parseMintArtworkInstruction,
} from "@katha/solana/registry";
import { unsignedOperationResponseSchema } from "@katha/shared";
import { createApi } from "../src/app.js";
import { temporaryWallet } from "./fixtures/wallet.js";
it("prepares the atomic generated mint without publishing or creating ownership", async () => {
  const f = await mintFixture();
  const before = structuredClone(f.snapshot);
  const response = await f.service.prepare(
    "Bearer synthetic",
    f.snapshot.artwork.kathaId,
    f.request,
  );
  unsignedOperationResponseSchema.parse(response);
  expect(response.kind).toBe("MINT_ARTWORK");
  const instruction = parseMintArtworkInstruction(
    f.simulate.mock.calls[0]![0].instruction,
  );
  expect(instruction.accounts.asset.address).toBe(f.accounts.assetAccount.address);
  expect(f.save.mock.calls[0]![0].expectedHashes).toEqual(
    [f.hash, f.snapshot.initialReport!.documentHash].sort(),
  );
  expect(f.save.mock.calls[0]![3].canonicalRequest).not.toContain(f.document.notes);
  expect(f.snapshot).toEqual(before);
});
it("requires current registration authority before private reads", async () => {
  const f = await mintFixture();
  f.authorities.registrationAuthority = temporaryWallet().address;
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.load).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
});
it.each([
  "published",
  "timestamp",
  "metadata-id",
  "metadata-draft",
  "report-draft",
  "hash",
  "storage",
  "metadata-version",
  "condition-version",
  "custody-version",
  "occupied",
  "artist",
  "identity",
  "verification",
  "report",
  "collection",
  "simulation",
  "save-race",
])("rejects mint %s", async (reason) => {
  const f = await mintFixture();
  if (reason === "published") f.snapshot.artwork.publishedAt = new Date();
  if (reason === "timestamp") f.request.expectedUpdatedAt = "2026-10-04T00:00:00.000Z";
  if (reason === "metadata-id")
    f.request.metadataVersionId = f.snapshot.initialReport!.id;
  if (reason === "metadata-draft") f.snapshot.metadata!.status = "DRAFT";
  if (reason === "report-draft") f.snapshot.initialReport!.status = "DRAFT";
  if (reason === "hash") f.snapshot.initialReport!.documentHash = "a".repeat(64);
  if (reason === "storage") f.read.mockResolvedValueOnce(new Uint8Array([1]));
  if (reason === "metadata-version") f.request.expectedMetadataVersion = 2;
  if (reason === "condition-version") f.request.expectedConditionVersion = 2;
  if (reason === "custody-version") f.request.expectedCustodyRevision = "2";
  if (reason === "occupied")
    f.accounts.assetAccount = {
      ...f.accounts.collectionAccount,
      exists: true,
      data: Uint8Array.from(f.accounts.collectionAccount.data),
    };
  if (reason === "artist") f.snapshot.artist!.verificationStatus = "UNVERIFIED";
  if (reason === "identity") f.snapshot.artwork.creationYear = 2025;
  if (reason === "verification")
    f.accounts.verificationAccount = f.accounts.metadataHeadAccount;
  if (reason === "report")
    f.accounts.initialConditionAccount = f.accounts.conditionHeadAccount;
  if (reason === "collection")
    f.accounts.collectionAccount = f.accounts.verificationAccount;
  if (reason === "simulation")
    f.simulate.mockRejectedValueOnce(new Error("Synthetic RPC failure"));
  if (reason === "save-race") f.save.mockResolvedValueOnce({ status: "conflict" });
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toThrow();
});
it("installs strict no-store mint preparation with redacted failures", async () => {
  const f = await mintFixture();
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
    f.service,
  );
  const send = (body: unknown = f.request, suffix = "") =>
    app.request(
      `/admin/artworks/${f.snapshot.artwork.kathaId}/operations/mint${suffix}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer synthetic",
        },
        body: JSON.stringify(body),
      },
    );
  const response = await send();
  expect(response.status).toBe(201);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(
    (await send({ ...f.request, assetAddress: f.accounts.assetAccount.address }))
      .status,
  ).toBe(400);
  expect((await send(f.request, "?private=true")).status).toBe(400);
  f.readChain.mockRejectedValueOnce(new Error("PRIVATE RPC DATA"));
  const error = await send();
  expect(error.status).toBe(500);
  expect(await error.text()).not.toContain("PRIVATE RPC DATA");
});

it.each([
  "bound-asset",
  "transit",
  "metadata-uri",
  "report-grade",
  "missing-report",
  "wrong-cluster",
  "private-storage",
])("rejects additional mint eligibility %s before persistence", async (reason) => {
  const f = await mintFixture();
  if (reason === "bound-asset") {
    const data = new Uint8Array(246);
    data.set(
      getArtworkRecordEncoder().encode({
        ...getArtworkRecordDecoder().decode(f.accounts.artworkAccount.data),
        coreAsset: f.accounts.assetAccount.address,
      }),
    );
    f.accounts.artworkAccount = { ...f.accounts.artworkAccount, data };
  }
  if (reason === "transit") {
    const data = new Uint8Array(115);
    data.set(
      getCustodyHeadEncoder().encode({
        ...getCustodyHeadDecoder().decode(f.accounts.custodyHeadAccount.data),
        state: CustodyState.InTransit,
        subject: null,
      }),
    );
    f.accounts.custodyHeadAccount = { ...f.accounts.custodyHeadAccount, data };
  }
  if (reason === "metadata-uri")
    f.snapshot.metadata!.uri = "http://localhost/different.json";
  if (reason === "report-grade") f.snapshot.initialReport!.grade = "POOR";
  if (reason === "missing-report") f.snapshot.initialReport = null;
  if (reason === "wrong-cluster") f.session.cluster = "devnet";
  if (reason === "private-storage")
    f.read
      .mockResolvedValueOnce(
        new TextEncoder().encode(f.snapshot.metadata!.canonicalDocument!),
      )
      .mockResolvedValueOnce(new Uint8Array([1]));
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toThrow();
  expect(f.save).not.toHaveBeenCalled();
});
it("rejects anonymous mint preparation before private reads", async () => {
  const f = await mintFixture();
  await expect(
    f.service.prepare(undefined, f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(f.load).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
  expect(f.readChain).not.toHaveBeenCalled();
});
