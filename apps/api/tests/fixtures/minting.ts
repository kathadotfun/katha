import { vi } from "vitest";
import type { ArtworkMintStore, ArtworkMintSnapshot } from "@katha/db";
import type { ArtworkMintReader } from "@katha/solana";
import {
  getKathaConfigDecoder,
  findInitializeMetadataHeadPda,
  findReviseMintedMetadataRevisionPda,
  findHeadPda,
  getMetadataHeadEncoder,
  getMetadataRevisionEncoder,
  getConditionHeadEncoder,
  getCustodyHeadEncoder,
  findInitializeCustodyHeadPda,
  findTransitionCustodyTransitionPda,
  CustodyState,
  findAssetPda,
} from "@katha/solana/registry";
import { conditionFixture } from "./condition-attestation.js";
import { createArtworkMinting } from "../../src/artwork-minting.js";
export async function mintFixture() {
  const f = await conditionFixture();
  const metadata = f.snapshot.artwork;
  // Keep the approved public metadata from the verification fixture and the initial private report.
  const document = {
    schemaVersion: 1,
    kathaId: metadata.kathaId,
    name: metadata.title,
    category: metadata.category,
    artist: {
      artistId: metadata.artistId,
      displayName: "Synthetic Artist",
      creatorWallet: metadata.creatorWallet,
    },
    creationYear: metadata.creationYear,
    origin: { countryCode: "NP", region: "Bagmati", locality: null },
    dimensions: { heightMm: 100, widthMm: 100, depthMm: null },
    materials: ["Canvas"],
    technique: "Synthetic technique",
    publicContent: {
      story: "Public story",
      meaning: "Public meaning",
      culturalContext: "Public context",
      creationProcess: "Public process",
    },
    image: "http://localhost:3001/storage/public/" + "a".repeat(64) + ".png",
    media: [
      {
        contentHash: "a".repeat(64),
        mimeType: "image/png",
        role: "HERO",
        uri: "http://localhost:3001/storage/public/" + "a".repeat(64) + ".png",
      },
    ],
  };
  const { canonicalDocumentBytes, sha256Hex } = await import("@katha/shared");
  const bytes = canonicalDocumentBytes(document);
  const hash = await sha256Hex(bytes);
  const at = metadata.updatedAt;
  const snapshot: ArtworkMintSnapshot = {
    artwork: metadata,
    artist: f.snapshot.artist,
    registered: true,
    metadata: {
      id: metadata.id,
      artworkId: metadata.id,
      version: 1,
      chainVersion: null,
      status: "PREPARED",
      authorityWallet: f.session.walletAddress,
      canonicalDocument: new TextDecoder().decode(bytes),
      documentHash: hash,
      uri: `http://localhost:3001/storage/public/${hash}.json`,
      createdAt: at,
      updatedAt: at,
      chainCluster: null,
      chainSignature: null,
      chainSlot: null,
      chainRecordedAt: null,
      finalizedAt: null,
    },
    initialReport: f.snapshot.report,
  };
  const cfg = getKathaConfigDecoder().decode(f.accounts.configAccount.data);
  const artwork = f.accounts.artworkAccount.address;
  const [head, bump] = await findInitializeMetadataHeadPda({ artwork });
  const [revision, revisionBump] = await findReviseMintedMetadataRevisionPda({
    artwork,
    nextVersion: 1,
  });
  const [condition, conditionBump] = await findHeadPda({ artwork });
  const [custody, custodyBump] = await findInitializeCustodyHeadPda({ artwork });
  const [transition] = await findTransitionCustodyTransitionPda({
    artwork,
    nextRevision: 1n,
  });
  const [asset] = await findAssetPda({ artwork });
  const account = (
    address: typeof artwork,
    bytes: Uint8Array | readonly number[],
    size = bytes.length,
  ) => {
    const data = new Uint8Array(size);
    data.set(bytes);
    return { ...f.accounts.artworkAccount, address, data, space: BigInt(size) };
  };
  // The report account is encoded using the actual generated codec, including its stored hash.
  const {
    findReportPda,
    getConditionAttestationEncoder,
    ConditionGrade,
    ConditionReason,
  } = await import("@katha/solana/registry");
  const reportId = Uint8Array.from(
    Buffer.from(f.document.reportId.replaceAll("-", ""), "hex"),
  );
  const [report, reportBump] = await findReportPda({ reportId });
  const initialConditionAccount = account(
    report,
    Uint8Array.from(
      getConditionAttestationEncoder().encode({
        artwork,
        version: 1,
        reportId,
        reportHash: Uint8Array.from(Buffer.from(f.hash, "hex")),
        grade: ConditionGrade.Good,
        reason: ConditionReason.InitialVerification,
        inspectorId: Uint8Array.from(
          Buffer.from(f.document.inspectorId.replaceAll("-", ""), "hex"),
        ),
        verifier: cfg.verifierAuthority,
        inspectedAt: BigInt(Math.floor(at.getTime() / 1000)),
        recordedAt: BigInt(Math.floor(at.getTime() / 1000)),
        ownerScope: null,
        custodyRevisionScope: null,
        bump: reportBump,
      }),
    ),
    201,
  );
  const name = Buffer.from("Synthetic collection"),
    uri = Buffer.from("http://localhost/collection.json");
  const length = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  // collectionAuthority bytes are the sixth role field in the fixed Registry configuration.
  const authorityBytes = f.accounts.configAccount.data.slice(8 + 32 * 6, 8 + 32 * 7);
  const collectionBytes = Buffer.concat([
    Buffer.from([5]),
    authorityBytes,
    length(name.length),
    name,
    length(uri.length),
    uri,
    Buffer.alloc(8),
  ]);
  const accounts: Awaited<ReturnType<ArtworkMintReader>> = {
    configAccount: f.accounts.configAccount,
    artworkAccount: f.accounts.artworkAccount,
    verificationAccount: f.accounts.verificationAccount,
    metadataHeadAccount: account(
      head,
      Uint8Array.from(
        getMetadataHeadEncoder().encode({
          artwork,
          version: 1,
          currentRevision: revision,
          currentHash: Uint8Array.from(Buffer.from(hash, "hex")),
          bump,
        }),
      ),
    ),
    currentRevisionAccount: account(
      revision,
      Uint8Array.from(
        getMetadataRevisionEncoder().encode({
          artwork,
          version: 1,
          documentHash: Uint8Array.from(Buffer.from(hash, "hex")),
          uri: snapshot.metadata!.uri!,
          committedBy: cfg.registrationAuthority,
          committedAt: 1n,
          bump: revisionBump,
        }),
      ),
      321,
    ),
    conditionHeadAccount: account(
      condition,
      Uint8Array.from(
        getConditionHeadEncoder().encode({
          artwork,
          version: 1,
          currentReport: report,
          currentHash: Uint8Array.from(Buffer.from(f.hash, "hex")),
          bump: conditionBump,
        }),
      ),
    ),
    initialConditionAccount,
    custodyHeadAccount: account(
      custody,
      Uint8Array.from(
        getCustodyHeadEncoder().encode({
          artwork,
          revision: 1n,
          state: CustodyState.KathaHeld,
          subject: cfg.custodyAuthority,
          latestTransition: transition,
          bump: custodyBump,
        }),
      ),
      115,
    ),
    collectionAccount: {
      ...account(cfg.collection, collectionBytes),
      programAddress: "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d" as typeof artwork,
    },
    assetAccount: { exists: false, address: asset },
  };
  const load = vi.fn<ArtworkMintStore["load"]>(async () => snapshot);
  const store: ArtworkMintStore = { load, operations: () => ({ save: f.save }) };
  const readChain = vi.fn<ArtworkMintReader>(async () => accounts);
  const read = vi.fn(async (input: { visibility: string }) =>
    input.visibility === "PUBLIC" ? bytes : f.bytes,
  );
  const storage = { ...f.storage, read };
  const request = {
    idempotencyKey: "synthetic-mint",
    expectedUpdatedAt: at.toISOString(),
    metadataVersionId: snapshot.metadata!.id,
    initialConditionReportId: f.document.reportId,
    expectedMetadataVersion: 1,
    expectedConditionVersion: 1,
    expectedCustodyRevision: "1",
    supportedTransactionVersions: [0],
  };
  const service = createArtworkMinting(
    store,
    f.authorization,
    readChain,
    f.chain,
    storage,
    "localnet",
  );
  return { ...f, snapshot, accounts, load, readChain, read, request, service, hash };
}
