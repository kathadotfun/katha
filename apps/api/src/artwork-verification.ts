import { validateArtworkDocumentation } from "./artwork-documentation.js";
import {
  artworkVerificationRequestSchema,
  artworkVerificationReviewSchema,
  registrationStatusSchema,
} from "@katha/shared";
import type { ArtworkVerificationStore } from "@katha/db";
import {
  buildVerifyArtworkTransaction,
  type ArtworkVerificationReader,
  readArtworkVerificationIdentity,
  type OperationChain,
} from "@katha/solana";
import { KATHA_REGISTRY_PROGRAM_ADDRESS } from "@katha/solana/registry";
import type { AuthorizationBoundary } from "./authorization.js";
import { type StorageProvider } from "./storage.js";
import { createBlockchainOperations } from "./blockchain-operations.js";
import { DomainError } from "./errors.js";

export function createArtworkVerification(
  store: ArtworkVerificationStore,
  authorization: AuthorizationBoundary,
  readChain: ArtworkVerificationReader,
  chain: OperationChain,
  storage: StorageProvider,
  cluster: "localnet" | "devnet",
  readRegistrationStatus?: (id: string) => Promise<unknown>,
  readVerificationStatus?: (id: string) => Promise<unknown>,
) {
  return {
    async review(bearer: string | undefined, kathaId: string) {
      const session = await authorization.requireRole(bearer, "verifier");
      if (session.cluster !== cluster) throw new DomainError("FORBIDDEN");
      const snapshot = await store.load(kathaId);
      if (!snapshot) throw new DomainError("NOT_FOUND");
      const { artwork, metadata, artist } = snapshot;
      const available = metadata && ["PREPARED", "FINALIZED"].includes(metadata.status);
      if (available) await validateArtworkDocumentation(snapshot, storage);
      const registration = registrationStatusSchema.parse(
        readRegistrationStatus
          ? await readRegistrationStatus(kathaId)
          : { finalized: snapshot.registered, unresolved: false, receipt: null },
      );
      const verification = registrationStatusSchema.parse(
        readVerificationStatus
          ? await readVerificationStatus(kathaId)
          : { finalized: false, unresolved: false, receipt: null },
      );
      return artworkVerificationReviewSchema.parse({
        kathaId,
        cluster,
        updatedAt: artwork.updatedAt.toISOString(),
        title: artwork.title,
        identity:
          artwork.authorshipEvidenceHash &&
          !/^0{64}$/.test(artwork.authorshipEvidenceHash)
            ? {
                artistId: artwork.artistId,
                creatorWallet: artwork.creatorWallet,
                category: artwork.category,
                creationYear: artwork.creationYear,
                authorshipEvidenceHash: artwork.authorshipEvidenceHash,
              }
            : null,
        artistVerified: artist?.verificationStatus === "VERIFIED",
        published: artwork.publishedAt !== null,
        metadata: available
          ? {
              id: metadata.id,
              version: metadata.version,
              status: metadata.status,
              documentHash: metadata.documentHash,
              uri: metadata.uri,
              canonicalDocument: metadata.canonicalDocument,
            }
          : null,
        registration,
        verification: {
          ...verification,
          finalized: verification.finalized || snapshot.verified,
          unresolved: verification.unresolved || snapshot.unresolved,
        },
      });
    },

    async prepare(bearer: string | undefined, kathaId: string, input: unknown) {
      const parsed = artworkVerificationRequestSchema.safeParse(input);
      if (!parsed.success) throw new DomainError("INVALID_REQUEST");
      const session = await authorization.requireRegistryAuthority(
        bearer,
        "verifierAuthority",
      );
      await authorization.requireRole(bearer, "verifier");
      if (session.cluster !== cluster) throw new DomainError("FORBIDDEN");
      if (
        cluster === "localnet" &&
        !parsed.data.supportedTransactionVersions.includes(0)
      )
        throw new DomainError("INVALID_REQUEST");
      const snapshot = await store.load(kathaId);
      if (!snapshot) throw new DomainError("NOT_FOUND");
      const { artwork, artist, metadata } = snapshot;
      if (readVerificationStatus) {
        const status = registrationStatusSchema.parse(
          await readVerificationStatus(kathaId),
        );
        if (status.finalized || status.unresolved) throw new DomainError("CONFLICT");
      }
      if (
        snapshot.verified ||
        snapshot.unresolved ||
        artwork.authorshipEvidenceHash !== parsed.data.reviewedEvidenceHash ||
        artwork.publishedAt !== null ||
        artwork.updatedAt.toISOString() !== parsed.data.expectedUpdatedAt ||
        artist?.verificationStatus !== "VERIFIED" ||
        !artwork.authorshipEvidenceHash ||
        /^0{64}$/.test(artwork.authorshipEvidenceHash) ||
        metadata?.id !== parsed.data.metadataVersionId ||
        metadata.status === "DRAFT" ||
        !metadata.documentHash ||
        !metadata.canonicalDocument ||
        !metadata.uri
      )
        throw new DomainError("CONFLICT");
      await validateArtworkDocumentation(snapshot, storage);
      let accounts;
      try {
        accounts = await readChain(kathaId);
      } catch (error) {
        if (error instanceof TypeError) throw new DomainError("CONFLICT");
        throw error;
      }
      if (accounts.verificationExists) throw new DomainError("CONFLICT");
      // Authorship is immutable; never authenticate a different local artist snapshot.
      let registered;
      try {
        registered = await readArtworkVerificationIdentity(
          accounts,
          session.walletAddress,
          artwork.kathaId,
          session.operatorAuthorization,
        );
      } catch (error) {
        if (error instanceof TypeError) throw new DomainError("CONFLICT");
        throw error;
      }
      const record = registered;
      if (
        record.artistId !== artwork.artistId ||
        record.creationYear !== artwork.creationYear ||
        (record.creatorWallet.__option === "Some"
          ? record.creatorWallet.value
          : null) !== artwork.creatorWallet ||
        record.coreAsset.__option !== "None"
      )
        throw new DomainError("CONFLICT");
      const verification = {
        kathaId: artwork.kathaId,
        artistId: artwork.artistId,
        creatorWallet: artwork.creatorWallet,
        category: artwork.category,
        creationYear: artwork.creationYear,
        authorshipEvidenceHash: artwork.authorshipEvidenceHash,
      };
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
          kind: "VERIFY_ARTWORK",
          idempotencyKey: parsed.data.idempotencyKey,
          expectedAccounts: [
            ...new Set([
              KATHA_REGISTRY_PROGRAM_ADDRESS,
              accounts.configAccount.address,
              accounts.artworkAccount.address,
              accounts.verificationAddress,
              "11111111111111111111111111111111",
              session.walletAddress,
            ]),
          ],
          expectedHashes: [artwork.authorshipEvidenceHash, metadata.documentHash],
          parameters: {
            ...verification,
            authenticityConfirmed: true,
            reviewedEvidenceHash: parsed.data.reviewedEvidenceHash,
            expectedUpdatedAt: parsed.data.expectedUpdatedAt,
            metadataVersionId: metadata.id,
            metadataVersion: metadata.version,
            metadataHash: metadata.documentHash,
            metadataUri: metadata.uri,
          },
        },
        new Set(parsed.data.supportedTransactionVersions),
        (context) =>
          buildVerifyArtworkTransaction(context, accounts, {
            kathaId: artwork.kathaId,
            expectedAuthorshipEvidenceHash: verification.authorshipEvidenceHash,
          }),
      );
    },
  };
}
export type ArtworkVerificationBoundary = ReturnType<typeof createArtworkVerification>;
