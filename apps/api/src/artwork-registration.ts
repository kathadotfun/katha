import { validateArtworkDocumentation } from "./artwork-documentation.js";
import { artworkRegistrationRequestSchema } from "@katha/shared";
import type { ArtworkRegistrationStore } from "@katha/db";
import {
  buildRegisterArtworkTransaction,
  type ArtworkRegistrationReader,
  type OperationChain,
} from "@katha/solana";
import { KATHA_REGISTRY_PROGRAM_ADDRESS } from "@katha/solana/registry";
import type { AuthorizationBoundary } from "./authorization.js";
import { type StorageProvider } from "./storage.js";
import { createBlockchainOperations } from "./blockchain-operations.js";
import { DomainError } from "./errors.js";

export function createArtworkRegistration(
  store: ArtworkRegistrationStore,
  authorization: AuthorizationBoundary,
  readChain: ArtworkRegistrationReader,
  chain: OperationChain,
  storage: StorageProvider,
  cluster: "localnet" | "devnet",
) {
  return {
    async prepare(bearer: string | undefined, kathaId: string, input: unknown) {
      const parsed = artworkRegistrationRequestSchema.safeParse(input);
      if (!parsed.success) throw new DomainError("INVALID_REQUEST");
      const session = await authorization.requireRegistryAuthority(
        bearer,
        "registrationAuthority",
      );
      await authorization.requireRole(bearer, "admin");
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
        snapshot.registered ||
        artwork.publishedAt !== null ||
        artwork.updatedAt.toISOString() !== parsed.data.expectedUpdatedAt ||
        artist?.verificationStatus !== "VERIFIED" ||
        !artwork.authorshipEvidenceHash ||
        /^0{64}$/.test(artwork.authorshipEvidenceHash) ||
        metadata?.id !== parsed.data.metadataVersionId ||
        metadata.status !== "PREPARED" ||
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
      if (accounts.artworkExists) throw new DomainError("CONFLICT");
      const registration = {
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
          kind: "REGISTER_ARTWORK",
          idempotencyKey: parsed.data.idempotencyKey,
          expectedAccounts: [
            ...new Set([
              KATHA_REGISTRY_PROGRAM_ADDRESS,
              accounts.configAccount.address,
              accounts.artworkAddress,
              "11111111111111111111111111111111",
              session.walletAddress,
            ]),
          ],
          expectedHashes: [artwork.authorshipEvidenceHash, metadata.documentHash],
          parameters: {
            ...registration,
            expectedUpdatedAt: parsed.data.expectedUpdatedAt,
            metadataVersionId: metadata.id,
            metadataVersion: metadata.version,
            metadataHash: metadata.documentHash,
            metadataUri: metadata.uri,
          },
        },
        new Set(parsed.data.supportedTransactionVersions),
        (context) =>
          buildRegisterArtworkTransaction(
            context,
            accounts.configAccount,
            registration,
          ),
      );
    },
  };
}
export type ArtworkRegistrationBoundary = ReturnType<typeof createArtworkRegistration>;
