import {
  artworkMintRequestSchema,
  conditionReportDocumentSchema,
  canonicalDocumentBytes,
  sha256Hex,
} from "@katha/shared";
import type { ArtworkMintStore } from "@katha/db";
import {
  buildMintArtworkTransaction,
  CORE_PROGRAM_ADDRESS,
  type ArtworkMintReader,
  type OperationChain,
} from "@katha/solana";
import {
  getMetadataHeadDecoder,
  getMetadataRevisionDecoder,
  getConditionHeadDecoder,
  getConditionAttestationDecoder,
  getCustodyHeadDecoder,
  getArtworkRecordDecoder,
  getKathaConfigDecoder,
  ConditionGrade,
  KATHA_REGISTRY_PROGRAM_ADDRESS,
} from "@katha/solana/registry";
import type { AuthorizationBoundary } from "./authorization.js";
import { StorageError, type StorageProvider } from "./storage.js";
import { validateArtworkDocumentation } from "./artwork-documentation.js";
import { createBlockchainOperations } from "./blockchain-operations.js";
import {
  createArtworkMintAdministration,
  type ArtworkMintAdministration,
} from "./artwork-mint-administration.js";
import { DomainError } from "./errors.js";
export function createArtworkMinting(
  store: ArtworkMintStore,
  authorization: AuthorizationBoundary,
  readChain: ArtworkMintReader,
  chain: OperationChain,
  storage: StorageProvider,
  cluster: "localnet" | "devnet",
  administration?: {
    store: Parameters<typeof createArtworkMintAdministration>[0];
    readStatus: Parameters<typeof createArtworkMintAdministration>[5];
  },
) {
  const admin = administration
    ? createArtworkMintAdministration(
        administration.store,
        authorization,
        readChain,
        storage,
        cluster,
        administration.readStatus,
      )
    : null;
  return {
    review(...args: Parameters<ArtworkMintAdministration["review"]>) {
      if (!admin) throw new DomainError("NOT_FOUND");
      return admin.review(...args);
    },
    publish(...args: Parameters<ArtworkMintAdministration["publish"]>) {
      if (!admin) throw new DomainError("NOT_FOUND");
      return admin.publish(...args);
    },
    async prepare(bearer: string | undefined, kathaId: string, input: unknown) {
      const parsed = artworkMintRequestSchema.safeParse(input);
      if (!parsed.success) throw new DomainError("INVALID_REQUEST");
      const request = parsed.data;
      const session = await authorization.requireRegistryAuthority(
        bearer,
        "registrationAuthority",
      );
      if (session.cluster !== cluster) throw new DomainError("FORBIDDEN");
      const snapshot = await store.load(kathaId, request.initialConditionReportId);
      if (!snapshot) throw new DomainError("NOT_FOUND");
      const { artwork, artist, metadata, initialReport } = snapshot;
      if (
        artwork.publishedAt !== null ||
        artwork.updatedAt.toISOString() !== request.expectedUpdatedAt ||
        artist?.verificationStatus !== "VERIFIED" ||
        metadata?.id !== request.metadataVersionId ||
        metadata.status === "DRAFT" ||
        !metadata.documentHash ||
        !metadata.uri ||
        !initialReport ||
        initialReport.status === "DRAFT" ||
        !initialReport.canonicalDocument ||
        !initialReport.documentHash
      )
        throw new DomainError("CONFLICT");
      await validateArtworkDocumentation(snapshot, storage);
      let document;
      try {
        document = conditionReportDocumentSchema.parse(
          JSON.parse(initialReport.canonicalDocument),
        );
      } catch {
        throw new DomainError("CONFLICT");
      }
      const bytes = canonicalDocumentBytes(document);
      if (
        new TextDecoder().decode(bytes) !== initialReport.canonicalDocument ||
        (await sha256Hex(bytes)) !== initialReport.documentHash ||
        document.scope ||
        document.reason !== "INITIAL_VERIFICATION" ||
        document.reportId !== initialReport.id ||
        document.kathaId !== kathaId ||
        document.verifierWallet !== initialReport.authorityWallet ||
        document.inspectorId !== initialReport.inspectorId ||
        document.grade !== initialReport.grade ||
        document.reason !== initialReport.reason ||
        document.notes !== initialReport.notes ||
        document.inspectedAt !== initialReport.inspectedAt.toISOString() ||
        document.reportedAt !== initialReport.reportedAt.toISOString() ||
        JSON.stringify(document.mediaHashes) !==
          JSON.stringify(initialReport.mediaHashes) ||
        initialReport.ownerWallet !== null ||
        initialReport.custodyRevision !== null
      )
        throw new DomainError("CONFLICT");
      try {
        const stored = await storage.read({
          storageKey: `private/${initialReport.documentHash}.json`,
          contentHash: initialReport.documentHash,
          mimeType: "application/json",
          visibility: "PRIVATE",
          byteSize: bytes.length.toString(),
        });
        if (
          (await sha256Hex(stored)) !== initialReport.documentHash ||
          new TextDecoder().decode(stored) !== initialReport.canonicalDocument
        )
          throw new DomainError("CONFLICT");
      } catch (error) {
        if (
          error instanceof StorageError &&
          ["NOT_FOUND", "INTEGRITY_FAILURE"].includes(error.code)
        )
          throw new DomainError("CONFLICT");
        throw error;
      }
      let accounts;
      try {
        accounts = await readChain(kathaId, request.initialConditionReportId);
      } catch (error) {
        if (error instanceof TypeError) throw new DomainError("CONFLICT");
        throw error;
      }
      try {
        const registered = getArtworkRecordDecoder().decode(
          accounts.artworkAccount.data,
        );
        const head = getMetadataHeadDecoder().decode(accounts.metadataHeadAccount.data);
        const current = getMetadataRevisionDecoder().decode(
          accounts.currentRevisionAccount.data,
        );
        const condition = getConditionHeadDecoder().decode(
          accounts.conditionHeadAccount.data,
        );
        const initial = getConditionAttestationDecoder().decode(
          accounts.initialConditionAccount.data,
        );
        const custody = getCustodyHeadDecoder().decode(
          accounts.custodyHeadAccount.data,
        );
        if (
          registered.coreAsset.__option !== "None" ||
          accounts.assetAccount.exists ||
          registered.artistId !== artwork.artistId ||
          registered.creationYear !== artwork.creationYear ||
          (registered.creatorWallet.__option === "Some"
            ? registered.creatorWallet.value
            : null) !== artwork.creatorWallet ||
          Buffer.from(registered.authorshipEvidenceHash).toString("hex") !==
            artwork.authorshipEvidenceHash ||
          head.version !== request.expectedMetadataVersion ||
          current.uri !== metadata.uri ||
          Buffer.from(current.documentHash).toString("hex") !== metadata.documentHash ||
          condition.version !== request.expectedConditionVersion ||
          Buffer.from(initial.reportHash).toString("hex") !==
            initialReport.documentHash ||
          initial.verifier !== document.verifierWallet ||
          Buffer.from(initial.inspectorId).toString("hex") !==
            document.inspectorId.replaceAll("-", "") ||
          initial.grade !==
            (
              {
                EXCELLENT: ConditionGrade.Excellent,
                GOOD: ConditionGrade.Good,
                FAIR: ConditionGrade.Fair,
                POOR: ConditionGrade.Poor,
                DAMAGED: ConditionGrade.Damaged,
              } as const
            )[document.grade] ||
          initial.inspectedAt !==
            BigInt(Math.floor(Date.parse(document.inspectedAt) / 1000)) ||
          custody.revision !== BigInt(request.expectedCustodyRevision)
        )
          throw new DomainError("CONFLICT");
      } catch (error) {
        if (error instanceof DomainError) throw error;
        throw new DomainError("CONFLICT");
      }
      return createBlockchainOperations(
        store.operations(snapshot, session.walletId, request.idempotencyKey),
        authorization,
        chain,
        cluster,
      ).prepare(
        bearer,
        {
          artworkId: artwork.id,
          kathaId,
          kind: "MINT_ARTWORK",
          idempotencyKey: request.idempotencyKey,
          expectedAccounts: [
            ...new Set([
              KATHA_REGISTRY_PROGRAM_ADDRESS,
              session.walletAddress,
              accounts.configAccount.address,
              accounts.artworkAccount.address,
              accounts.verificationAccount.address,
              accounts.metadataHeadAccount.address,
              accounts.currentRevisionAccount.address,
              accounts.conditionHeadAccount.address,
              accounts.initialConditionAccount.address,
              accounts.custodyHeadAccount.address,
              accounts.collectionAccount.address,
              // Collection authority is a Registry PDA and the initial owner is the signing authority.
              getKathaConfigDecoder().decode(accounts.configAccount.data)
                .collectionAuthority,
              accounts.assetAccount.address,
              CORE_PROGRAM_ADDRESS,
              "11111111111111111111111111111111",
            ]),
          ],
          expectedHashes: [metadata.documentHash, initialReport.documentHash],
          parameters: {
            metadataVersionId: metadata.id,
            metadataHash: metadata.documentHash,
            metadataUri: metadata.uri,
            initialConditionReportId: initialReport.id,
            initialConditionHash: initialReport.documentHash,
            expectedUpdatedAt: request.expectedUpdatedAt,
            expectedMetadataVersion: request.expectedMetadataVersion,
            expectedConditionVersion: request.expectedConditionVersion,
            expectedCustodyRevision: request.expectedCustodyRevision,
          },
        },
        new Set(request.supportedTransactionVersions),
        (context) => buildMintArtworkTransaction(context, accounts, kathaId),
      );
    },
  };
}
export type ArtworkMintingBoundary = ReturnType<typeof createArtworkMinting>;
