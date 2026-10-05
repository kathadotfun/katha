import {
  conditionAttestationRequestSchema,
  conditionReportDocumentSchema,
  canonicalDocumentBytes,
  sha256Hex,
} from "@katha/shared";
import type { ConditionAttestationStore } from "@katha/db";
import {
  buildInitializeConditionTransaction,
  buildRecordUnmintedConditionTransaction,
  buildRecordMintedConditionTransaction,
  readArtworkVerificationIdentity,
  type ConditionAttestationReader,
  type OperationChain,
} from "@katha/solana";
import {
  KATHA_REGISTRY_PROGRAM_ADDRESS,
  getConditionHeadDecoder,
} from "@katha/solana/registry";
import type { AuthorizationBoundary } from "./authorization.js";
import { StorageError, type StorageProvider } from "./storage.js";
import { createBlockchainOperations } from "./blockchain-operations.js";
import { DomainError } from "./errors.js";
export function createConditionAttestation(
  store: ConditionAttestationStore,
  authorization: AuthorizationBoundary,
  readChain: ConditionAttestationReader,
  chain: OperationChain,
  storage: StorageProvider,
  cluster: "localnet" | "devnet",
) {
  return {
    async prepare(bearer: string | undefined, kathaId: string, input: unknown) {
      const parsed = conditionAttestationRequestSchema.safeParse(input);
      if (!parsed.success) throw new DomainError("INVALID_REQUEST");
      const request = parsed.data;
      const session = await authorization.requireRegistryAuthority(
        bearer,
        "verifierAuthority",
      );
      if (session.cluster !== cluster) throw new DomainError("FORBIDDEN");
      if (cluster === "localnet" && !request.supportedTransactionVersions.includes(0))
        throw new DomainError("INVALID_REQUEST");
      const snapshot = await store.load(kathaId);
      if (!snapshot) throw new DomainError("NOT_FOUND");
      const { artwork, artist, report } = snapshot;
      if (
        artwork.updatedAt.toISOString() !== request.expectedUpdatedAt ||
        artist?.verificationStatus !== "VERIFIED" ||
        report?.id !== request.reportId ||
        report.status !== "PREPARED" ||
        !report.canonicalDocument ||
        !report.documentHash ||
        report.authorityWallet !== session.walletAddress
      )
        throw new DomainError("CONFLICT");
      let document;
      try {
        document = conditionReportDocumentSchema.parse(
          JSON.parse(report.canonicalDocument),
        );
      } catch {
        throw new DomainError("CONFLICT");
      }
      const bytes = canonicalDocumentBytes(document);
      if (
        new TextDecoder().decode(bytes) !== report.canonicalDocument ||
        (await sha256Hex(bytes)) !== report.documentHash ||
        document.kathaId !== artwork.kathaId ||
        document.reportId !== report.id ||
        document.verifierWallet !== session.walletAddress ||
        document.inspectorId !== report.inspectorId ||
        document.grade !== report.grade ||
        document.reason !== report.reason ||
        document.inspectedAt !== report.inspectedAt.toISOString() ||
        document.reportedAt !== report.reportedAt.toISOString() ||
        document.notes !== report.notes ||
        JSON.stringify(document.mediaHashes) !== JSON.stringify(report.mediaHashes) ||
        (document.scope?.ownerWallet ?? null) !== report.ownerWallet ||
        (document.scope?.custodyRevision ?? null) !== report.custodyRevision
      )
        throw new DomainError("CONFLICT");
      try {
        const stored = await storage.read({
          storageKey: `private/${report.documentHash}.json`,
          contentHash: report.documentHash,
          mimeType: "application/json",
          visibility: "PRIVATE",
          byteSize: bytes.length.toString(),
        });
        if (
          (await sha256Hex(stored)) !== report.documentHash ||
          new TextDecoder().decode(stored) !== report.canonicalDocument
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
      let accounts, record;
      try {
        accounts = await readChain(kathaId, request.reportId);
        record = await readArtworkVerificationIdentity(
          accounts,
          session.walletAddress,
          kathaId,
        );
      } catch (error) {
        if (error instanceof TypeError) throw new DomainError("CONFLICT");
        throw error;
      }
      if (
        accounts.targetReportExists ||
        record.artistId !== artwork.artistId ||
        record.creationYear !== artwork.creationYear ||
        (record.creatorWallet.__option === "Some"
          ? record.creatorWallet.value
          : null) !== artwork.creatorWallet ||
        Buffer.from(record.authorshipEvidenceHash).toString("hex") !==
          artwork.authorshipEvidenceHash
      )
        throw new DomainError("CONFLICT");
      const minted = record.coreAsset.__option === "Some";
      const head = accounts.conditionHeadAccount.exists
        ? getConditionHeadDecoder().decode(accounts.conditionHeadAccount.data)
        : null;
      if ((head?.version ?? 0) !== request.expectedConditionVersion)
        throw new DomainError("CONFLICT");
      const expectedAccounts = [
        KATHA_REGISTRY_PROGRAM_ADDRESS,
        session.walletAddress,
        accounts.configAccount.address,
        accounts.artworkAccount.address,
        accounts.verificationAccount.address,
        accounts.conditionHeadAccount.address,
        accounts.targetReportAddress,
        "11111111111111111111111111111111",
        ...(minted
          ? [accounts.custodyHeadAccount.address, accounts.assetAccount.address]
          : []),
      ];
      return createBlockchainOperations(
        store.operations(snapshot),
        authorization,
        chain,
        cluster,
      ).prepare(
        bearer,
        {
          artworkId: artwork.id,
          kathaId: artwork.kathaId,
          kind: "RECORD_CONDITION",
          idempotencyKey: request.idempotencyKey,
          expectedAccounts: [...new Set(expectedAccounts)],
          expectedHashes: [report.documentHash],
          parameters: {
            reportId: report.id,
            reportVersion: report.version,
            reportHash: report.documentHash,
            expectedUpdatedAt: request.expectedUpdatedAt,
            expectedConditionVersion: request.expectedConditionVersion,
            scope: document.scope ?? null,
          },
        },
        new Set(request.supportedTransactionVersions),
        async (context) => {
          const attestation = {
            document,
            commitment: {
              reportId: report.id,
              kathaId: artwork.kathaId,
              reportHash: report.documentHash!,
            },
            currentUnixTimestamp: accounts.currentUnixTimestamp,
          };
          if (!head)
            return buildInitializeConditionTransaction(context, accounts, attestation);
          if (!accounts.conditionHeadAccount.exists || !accounts.currentReportAccount)
            throw new TypeError("Condition head is incomplete");
          const current = {
            ...accounts,
            conditionHeadAccount: accounts.conditionHeadAccount,
            currentReportAccount: accounts.currentReportAccount,
          };
          const data = {
            ...attestation,
            expectedVersion: request.expectedConditionVersion,
          };
          if (!minted)
            return buildRecordUnmintedConditionTransaction(context, current, data);
          if (!accounts.custodyHeadAccount.exists || !accounts.assetAccount.exists)
            throw new TypeError("Minted scope is unavailable");
          return buildRecordMintedConditionTransaction(
            context,
            {
              ...current,
              custodyHeadAccount: accounts.custodyHeadAccount,
              assetAccount: accounts.assetAccount,
            },
            data,
          );
        },
      );
    },
  };
}
export type ConditionAttestationBoundary = ReturnType<
  typeof createConditionAttestation
>;
