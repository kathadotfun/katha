import { expect, it } from "vitest";
import {
  canonicalDocumentBytes,
  sha256Hex,
  unsignedOperationResponseSchema,
} from "@katha/shared";
import { OperationSimulationError } from "@katha/solana";
import {
  getCustodyHeadDecoder,
  getCustodyHeadEncoder,
  CustodyState,
  parseInitializeConditionInstruction,
  parseRecordUnmintedConditionInstruction,
  parseRecordMintedConditionInstruction,
} from "@katha/solana/registry";
import { conditionFixture } from "./fixtures/condition-attestation.js";
import { temporaryWallet } from "./fixtures/wallet.js";
import { createApi } from "../src/app.js";
it.each(["initial", "unminted", "minted"] as const)(
  "prepares actual generated %s condition without finalized history",
  async (mode) => {
    const f = await conditionFixture(mode);
    const before = structuredClone(f.snapshot);
    const response = await f.service.prepare(
      "Bearer synthetic",
      f.snapshot.artwork.kathaId,
      f.request,
    );
    unsignedOperationResponseSchema.parse(response);
    expect(response.kind).toBe("RECORD_CONDITION");
    const instruction = f.simulate.mock.calls[0]![0].instruction;
    const ix =
      mode === "initial"
        ? parseInitializeConditionInstruction(instruction)
        : mode === "unminted"
          ? parseRecordUnmintedConditionInstruction(instruction)
          : parseRecordMintedConditionInstruction(instruction);
    expect(Buffer.from(ix.data.reportHash).toString("hex")).toBe(f.hash);
    const [operation, , , artifact] = f.save.mock.calls[0]!;
    expect(operation.expectedHashes).toEqual([f.hash]);
    expect(JSON.parse(artifact.canonicalRequest).parameters.scope).toEqual(
      f.document.scope ?? null,
    );
    expect(JSON.stringify(response)).not.toContain(f.document.notes);
    expect(artifact.canonicalRequest).not.toContain(f.document.notes);
    expect(f.snapshot).toEqual(before);
    expect(f.read.mock.calls[0]![0]).toMatchObject({ visibility: "PRIVATE" });
  },
);
it.each([undefined, "Bearer outsider"])(
  "denies unauthorized access before private reads",
  async (bearer) => {
    const f = await conditionFixture();
    await expect(
      f.service.prepare(bearer, f.snapshot.artwork.kathaId, f.request),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(f.load).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
    expect(f.readChain).not.toHaveBeenCalled();
  },
);
it("requires the current verifier authority before report reads", async () => {
  const f = await conditionFixture();
  f.authorities.verifierAuthority = temporaryWallet().address;
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.load).not.toHaveBeenCalled();
});
it.each([
  "stale-draft",
  "wrong-id",
  "draft-report",
  "finalized-report",
  "wrong-author",
  "hash",
  "private-bytes",
  "version",
  "occupied",
  "future",
  "no-artist",
])("rejects %s without saving", async (reason) => {
  const f = await conditionFixture();
  if (reason === "stale-draft")
    f.request.expectedUpdatedAt = "2026-10-04T00:00:00.000Z";
  if (reason === "wrong-id") f.request.reportId = f.snapshot.artwork.id;
  if (reason === "draft-report") f.snapshot.report!.status = "DRAFT";
  if (reason === "finalized-report") f.snapshot.report!.status = "FINALIZED";
  if (reason === "wrong-author")
    f.snapshot.report!.authorityWallet = temporaryWallet().address;
  if (reason === "hash") f.snapshot.report!.documentHash = "b".repeat(64);
  if (reason === "private-bytes") f.read.mockResolvedValueOnce(new Uint8Array([1]));
  if (reason === "version") f.request.expectedConditionVersion = 1;
  if (reason === "occupied") f.accounts.targetReportExists = true;
  if (reason === "future") f.accounts.currentUnixTimestamp = 1n;
  if (reason === "no-artist") f.snapshot.artist!.verificationStatus = "UNVERIFIED";
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.save).not.toHaveBeenCalled();
});
it.each(["owner", "custody", "missing-asset", "missing-custody", "scope"])(
  "rejects stale minted %s",
  async (reason) => {
    const f = await conditionFixture("minted");
    if (reason === "owner" && f.accounts.assetAccount.exists) {
      const data = Uint8Array.from(f.accounts.assetAccount.data);
      data[1] = (data[1] ?? 0) ^ 1;
      f.accounts.assetAccount = { ...f.accounts.assetAccount, data };
    }
    if (reason === "custody" && f.accounts.custodyHeadAccount.exists) {
      const data = Uint8Array.from(f.accounts.custodyHeadAccount.data);
      data[40] = 2;
      f.accounts.custodyHeadAccount = { ...f.accounts.custodyHeadAccount, data };
    }
    if (reason === "missing-asset")
      f.accounts.assetAccount = {
        exists: false,
        address: f.accounts.assetAccount.address,
      };
    if (reason === "missing-custody")
      f.accounts.custodyHeadAccount = {
        exists: false,
        address: f.accounts.custodyHeadAccount.address,
      };
    if (reason === "scope") f.snapshot.report!.ownerWallet = temporaryWallet().address;
    await expect(
      f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.save).not.toHaveBeenCalled();
  },
);
it("does not save rejected simulations or raced snapshots", async () => {
  const f = await conditionFixture();
  f.simulate.mockRejectedValueOnce(new OperationSimulationError("REJECTED"));
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.save).not.toHaveBeenCalled();
  f.save.mockResolvedValueOnce({ status: "conflict" });
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("installs a protected strict no-store condition route", async () => {
  const f = await conditionFixture();
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
    f.service,
  );
  const path = `/verifier/artworks/${f.snapshot.artwork.kathaId}/operations/condition`;
  const send = (body: unknown = f.request, auth = "Bearer synthetic", suffix = "") =>
    app.request(path + suffix, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(body),
    });
  const response = await send();
  expect(response.status).toBe(201);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect((await send(f.request, "Bearer outsider")).status).toBe(401);
  expect((await send({ ...f.request, reportHash: f.hash })).status).toBe(400);
  expect(
    (await send(f.request, "Bearer synthetic", "?includePrivate=true")).status,
  ).toBe(400);
  f.readChain.mockRejectedValueOnce(new Error("PRIVATE RPC FAILURE"));
  const error = await send();
  expect(error.status).toBe(500);
  expect(await error.text()).not.toContain("PRIVATE RPC FAILURE");
});

it("binds collector-held inspection scope to the current owner", async () => {
  const f = await conditionFixture("minted");
  f.document.scope!.custodyState = "COLLECTOR_HELD";
  const bytes = canonicalDocumentBytes(f.document);
  const hash = await sha256Hex(bytes);
  f.snapshot.report!.canonicalDocument = new TextDecoder().decode(bytes);
  f.snapshot.report!.documentHash = hash;
  f.read.mockResolvedValue(bytes);
  if (!f.accounts.custodyHeadAccount.exists) throw new Error("Missing fixture");
  const custody = getCustodyHeadDecoder().decode(f.accounts.custodyHeadAccount.data);
  f.accounts.custodyHeadAccount = {
    ...f.accounts.custodyHeadAccount,
    data: Uint8Array.from(
      getCustodyHeadEncoder().encode({ ...custody, state: CustodyState.CollectorHeld }),
    ),
  };
  await f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request);
  expect(f.save).toHaveBeenCalledOnce();
  const ix = parseRecordMintedConditionInstruction(
    f.simulate.mock.calls[0]![0].instruction,
  );
  expect(ix.data.expectedOwner).toBe(f.document.scope!.ownerWallet);
  expect(ix.data.expectedCustodyRevision).toBe(1n);
});
