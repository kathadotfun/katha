import { validateArtworkDocumentation } from "./artwork-documentation.js";
import { artworkVerificationRequestSchema } from "@katha/shared";
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
) {
  return {
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
      if (
        snapshot.verified ||
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
