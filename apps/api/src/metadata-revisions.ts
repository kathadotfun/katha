import { metadataRevisionRequestSchema } from "@katha/shared";
import type { MetadataRevisionStore } from "@katha/db";
import {
  buildInitializeMetadataTransaction,
  buildReviseUnmintedMetadataTransaction,
  buildReviseMintedMetadataTransaction,
  CORE_PROGRAM_ADDRESS,
  type MetadataRevisionReader,
  type OperationChain,
} from "@katha/solana";
import {
  findInitializeMetadataHeadPda,
  findReviseMintedMetadataRevisionPda,
  getMetadataHeadDecoder,
  getMetadataRevisionDecoder,
  getArtworkRecordDecoder,
  getKathaConfigDecoder,
  KATHA_REGISTRY_PROGRAM_ADDRESS,
} from "@katha/solana/registry";
import type { AuthorizationBoundary } from "./authorization.js";
import type { StorageProvider } from "./storage.js";
import { validateArtworkDocumentation } from "./artwork-documentation.js";
import { createBlockchainOperations } from "./blockchain-operations.js";
import { DomainError } from "./errors.js";

export function createMetadataRevisions(
  store: MetadataRevisionStore,
  authorization: AuthorizationBoundary,
  readChain: MetadataRevisionReader,
  chain: OperationChain,
  storage: StorageProvider,
  cluster: "localnet" | "devnet",
) {
  return {
    async prepare(bearer: string | undefined, kathaId: string, input: unknown) {
      const parsed = metadataRevisionRequestSchema.safeParse(input);
      if (!parsed.success) throw new DomainError("INVALID_REQUEST");
      const request = parsed.data;
      const session = await authorization.requireRegistryAuthority(
        bearer,
        "registrationAuthority",
      );
      if (session.cluster !== cluster) throw new DomainError("FORBIDDEN");
      const snapshot = await store.load(kathaId);
      if (!snapshot) throw new DomainError("NOT_FOUND");
      const { artwork, metadata, artist } = snapshot;
      if (
        artwork.updatedAt.toISOString() !== request.expectedUpdatedAt ||
        artist?.verificationStatus !== "VERIFIED" ||
        metadata?.id !== request.metadataVersionId ||
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
      let currentUri: string | null = null;
      try {
        const registered = getArtworkRecordDecoder().decode(
          accounts.artworkAccount.data,
        );
        if (
          registered.artistId !== artwork.artistId ||
          registered.creationYear !== artwork.creationYear ||
          (registered.creatorWallet.__option === "Some"
            ? registered.creatorWallet.value
            : null) !== artwork.creatorWallet ||
          Buffer.from(registered.authorshipEvidenceHash).toString("hex") !==
            artwork.authorshipEvidenceHash
        )
          throw new DomainError("CONFLICT");
        if (accounts.mode === "INITIALIZE") {
          if (
            request.expectedMetadataVersion !== 0 ||
            request.expectedMetadataHash !== null ||
            registered.coreAsset.__option !== "None"
          )
            throw new DomainError("CONFLICT");
        } else {
          const head = getMetadataHeadDecoder().decode(
            accounts.metadataHeadAccount.data,
          );
          const current = getMetadataRevisionDecoder().decode(
            accounts.currentRevisionAccount.data,
          );
          const hash = Buffer.from(current.documentHash).toString("hex");
          if (
            head.version !== request.expectedMetadataVersion ||
            hash !== request.expectedMetadataHash ||
            (current.uri === metadata.uri && hash === metadata.documentHash)
          )
            throw new DomainError("CONFLICT");
          currentUri = current.uri;
        }
      } catch (error) {
        if (error instanceof DomainError) throw error;
        throw new DomainError("CONFLICT");
      }
      const [head] = await findInitializeMetadataHeadPda({
        artwork: accounts.artworkAccount.address,
      });
      const [revision] = await findReviseMintedMetadataRevisionPda({
        artwork: accounts.artworkAccount.address,
        nextVersion: request.expectedMetadataVersion + 1,
      });
      const expectedAccounts = [
        KATHA_REGISTRY_PROGRAM_ADDRESS,
        session.walletAddress,
        accounts.configAccount.address,
        accounts.artworkAccount.address,
        head,
        revision,
        "11111111111111111111111111111111",
      ];
      if (accounts.mode === "MINTED")
        expectedAccounts.push(
          accounts.currentRevisionAccount.address,
          accounts.collectionAccount.address,
          accounts.assetAccount.address,
          getKathaConfigDecoder().decode(accounts.configAccount.data)
            .collectionAuthority,
          CORE_PROGRAM_ADDRESS,
        );
      const documentBytes = new TextEncoder().encode(metadata.canonicalDocument);
      const next = { kathaId, documentBytes, uri: metadata.uri };
      return createBlockchainOperations(
        store.operations(snapshot),
        authorization,
        chain,
        cluster,
      ).prepare(
        bearer,
        {
          artworkId: artwork.id,
          kathaId,
          kind: "REVISE_METADATA",
          idempotencyKey: request.idempotencyKey,
          expectedAccounts: [...new Set(expectedAccounts)],
          expectedHashes: [
            metadata.documentHash,
            ...(request.expectedMetadataHash ? [request.expectedMetadataHash] : []),
          ],
          parameters: {
            mode: accounts.mode,
            metadataVersionId: metadata.id,
            localMetadataVersion: metadata.version,
            metadataHash: metadata.documentHash,
            metadataUri: metadata.uri,
            expectedUpdatedAt: request.expectedUpdatedAt,
            expectedMetadataVersion: request.expectedMetadataVersion,
            expectedMetadataHash: request.expectedMetadataHash,
            currentUri,
          },
        },
        new Set(request.supportedTransactionVersions),
        (context) => {
          if (accounts.mode === "INITIALIZE")
            return buildInitializeMetadataTransaction(context, accounts, next);
          const input = { ...next, expectedVersion: request.expectedMetadataVersion };
          return accounts.mode === "MINTED"
            ? buildReviseMintedMetadataTransaction(context, accounts, input)
            : buildReviseUnmintedMetadataTransaction(context, accounts, input);
        },
      );
    },
  };
}
export type MetadataRevisionsBoundary = ReturnType<typeof createMetadataRevisions>;
