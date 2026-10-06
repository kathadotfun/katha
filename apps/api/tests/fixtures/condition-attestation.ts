import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import {
  canonicalDocumentBytes,
  sha256Hex,
  type ConditionReportDocument,
} from "@katha/shared";
import type {
  ConditionAttestationSnapshot,
  ConditionAttestationStore,
} from "@katha/db";
import type { ConditionAttestationReader } from "@katha/solana";
import {
  findHeadPda,
  findReportPda,
  findVerificationPda,
  findAssetPda,
  findInitializeCustodyHeadPda,
  findTransitionCustodyTransitionPda,
  getArtworkRecordDecoder,
  getArtworkRecordEncoder,
  getArtworkVerificationEncoder,
  getConditionHeadEncoder,
  getConditionAttestationEncoder,
  getCustodyHeadEncoder,
  CustodyState,
  ConditionReason,
  ConditionGrade,
} from "@katha/solana/registry";
import type { StorageProvider } from "../../src/storage.js";
import { createConditionAttestation } from "../../src/condition-attestation.js";
import { verificationFixture } from "./verification.js";
export async function conditionFixture(
  mode: "initial" | "unminted" | "minted" = "initial",
) {
  const f = await verificationFixture();
  const base = await f.readChain(f.snapshot.artwork.kathaId);
  const at = f.snapshot.artwork.updatedAt;
  const id = randomUUID();
  const wallet = f.session.walletAddress;
  const document: ConditionReportDocument = {
    reportId: id,
    kathaId: f.snapshot.artwork.kathaId,
    inspectorId: randomUUID(),
    verifierWallet: wallet,
    grade: "GOOD",
    reason:
      mode === "initial"
        ? "INITIAL_VERIFICATION"
        : mode === "minted"
          ? "PRE_RESALE"
          : "PRE_SALE",
    inspectedAt: at.toISOString(),
    reportedAt: at.toISOString(),
    notes: "SYNTHETIC PRIVATE CONDITION NOTES",
    mediaHashes: ["a".repeat(64)],
    ...(mode === "minted"
      ? {
          scope: {
            ownerWallet: wallet,
            custodyRevision: 1,
            custodyState: "KATHA_HELD" as const,
          },
        }
      : {}),
  };
  const bytes = canonicalDocumentBytes(document);
  const hash = await sha256Hex(bytes);
  const snapshot: ConditionAttestationSnapshot = {
    media: [],
    unresolved: false,
    attested: false,
    artwork: f.snapshot.artwork,
    artist: f.snapshot.artist,
    report: {
      id,
      artworkId: f.snapshot.artwork.id,
      status: "PREPARED",
      authorityWallet: wallet,
      canonicalDocument: new TextDecoder().decode(bytes),
      documentHash: hash,
      version: mode === "initial" ? 1 : 2,
      chainVersion: null,
      inspectorId: document.inspectorId,
      grade: document.grade,
      reason: document.reason,
      notes: document.notes,
      mediaHashes: document.mediaHashes,
      inspectedAt: at,
      reportedAt: at,
      ownerWallet: document.scope?.ownerWallet ?? null,
      custodyRevision: document.scope?.custodyRevision ?? null,
      createdAt: at,
      updatedAt: at,
      chainCluster: null,
      chainSignature: null,
      chainSlot: null,
      chainRecordedAt: null,
      finalizedAt: null,
    },
  };
  const artwork = base.artworkAccount.address;
  const [verification, verificationBump] = await findVerificationPda({ artwork });
  const [head, headBump] = await findHeadPda({ artwork });
  const [custody, custodyBump] = await findInitializeCustodyHeadPda({ artwork });
  const [asset] = await findAssetPda({ artwork });
  const [transition] = await findTransitionCustodyTransitionPda({
    artwork,
    nextRevision: 1n,
  });
  const idBytes = (uuid: string) =>
    Uint8Array.from(Buffer.from(uuid.replaceAll("-", ""), "hex"));
  const [target] = await findReportPda({ reportId: idBytes(id) });
  const previousId = randomUUID();
  const [previous, previousBump] = await findReportPda({
    reportId: idBytes(previousId),
  });
  const account = (
    address: typeof artwork,
    data: Uint8Array | readonly number[],
    size = data.length,
  ) => {
    const padded = new Uint8Array(size);
    padded.set(data);
    return { ...base.artworkAccount, address, data: padded, space: BigInt(size) };
  };
  const verificationAccount = account(
    verification,
    Uint8Array.from(
      getArtworkVerificationEncoder().encode({
        artwork,
        authorshipEvidenceHash: new Uint8Array(32).fill(0xee),
        verifier: wallet as never,
        verifiedAt: 1n,
        bump: verificationBump,
      }),
    ),
  );
  const previousAccount = account(
    previous,
    Uint8Array.from(
      getConditionAttestationEncoder().encode({
        artwork,
        version: 1,
        reportId: idBytes(previousId),
        reportHash: new Uint8Array(32).fill(1),
        grade: ConditionGrade.Good,
        reason: ConditionReason.InitialVerification,
        inspectorId: idBytes(document.inspectorId),
        verifier: wallet as never,
        inspectedAt: 1n,
        recordedAt: 2n,
        ownerScope: null,
        custodyRevisionScope: null,
        bump: previousBump,
      }),
    ),
    201,
  );
  const headAccount = account(
    head,
    Uint8Array.from(
      getConditionHeadEncoder().encode({
        artwork,
        version: 1,
        currentReport: previous,
        currentHash: new Uint8Array(32).fill(1),
        bump: headBump,
      }),
    ),
  );
  let artworkAccount = base.artworkAccount;
  if (mode === "minted")
    artworkAccount = account(
      artwork,
      Uint8Array.from(
        getArtworkRecordEncoder().encode({
          ...getArtworkRecordDecoder().decode(base.artworkAccount.data),
          coreAsset: asset,
        }),
      ),
      246,
    );
  // Synthetic minimal Core AssetV1 bytes. No real media or key material.
  const ownerBytes = Buffer.from(base.configAccount.data.slice(8, 40));
  const name = Buffer.from(document.kathaId),
    uri = Buffer.from("http://localhost/synthetic.json");
  const length = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const coreData = Buffer.concat([
    Buffer.from([1]),
    ownerBytes,
    Buffer.from([2]),
    ownerBytes,
    length(name.length),
    name,
    length(uri.length),
    uri,
    Buffer.from([0]),
  ]);
  const assetAccount = {
    ...account(asset, coreData),
    programAddress:
      "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d" as typeof base.configAccount.programAddress,
  };
  const custodyAccount = account(
    custody,
    Uint8Array.from(
      getCustodyHeadEncoder().encode({
        artwork,
        revision: 1n,
        state: CustodyState.KathaHeld,
        subject: wallet as never,
        latestTransition: transition,
        bump: custodyBump,
      }),
    ),
    115,
  );
  const accounts: Awaited<ReturnType<ConditionAttestationReader>> = {
    configAccount: base.configAccount,
    artworkAccount,
    verificationAccount,
    conditionHeadAccount:
      mode === "initial" ? { exists: false, address: head } : headAccount,
    custodyHeadAccount:
      mode === "minted" ? custodyAccount : { exists: false, address: custody },
    assetAccount: mode === "minted" ? assetAccount : { exists: false, address: asset },
    currentReportAccount: mode === "initial" ? null : previousAccount,
    currentUnixTimestamp: BigInt(Math.floor(at.getTime() / 1000)) + 60n,
    targetReportAddress: target,
    targetReportExists: false,
  };
  const load = vi.fn<ConditionAttestationStore["load"]>(async () => snapshot);
  const store: ConditionAttestationStore = {
    load,
    operations: () => ({ save: f.save }),
  };
  const readChain = vi.fn<ConditionAttestationReader>(async () => accounts);
  const read = vi.fn<StorageProvider["read"]>(async () => bytes);
  const storage = { ...f.storage, read };
  const request = {
    idempotencyKey: "synthetic-condition",
    expectedUpdatedAt: at.toISOString(),
    reportId: id as string,
    expectedConditionVersion: mode === "initial" ? 0 : 1,
    supportedTransactionVersions: [0],
  };
  const service = createConditionAttestation(
    store,
    f.authorization,
    readChain,
    f.chain,
    storage,
    "localnet",
  );
  return {
    ...f,
    snapshot,
    accounts,
    document,
    bytes,
    hash,
    load,
    store,
    readChain,
    read,
    request,
    service,
    storage,
  };
}
