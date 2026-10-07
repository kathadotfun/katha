import {
  artworkMintReviewSchema,
  artworkPublicationRequestSchema,
  type ArtworkRegistrationReview,
} from "@katha/shared";
import type { ArtworkPublicationStore, ArtworkPublicationSnapshot } from "@katha/db";
import {
  readArtworkMintState,
  RegistryLifecycleError,
  type ArtworkMintReader,
} from "@katha/solana";
import { getKathaConfigDecoder, ArtworkCategory } from "@katha/solana/registry";
import type { AuthorizationBoundary } from "./authorization.js";
import type { StorageProvider } from "./storage.js";
import { validateArtworkDocumentation } from "./artwork-documentation.js";
import { DomainError } from "./errors.js";
export function createArtworkMintAdministration(
  store: ArtworkPublicationStore,
  authorization: AuthorizationBoundary,
  readChain: ArtworkMintReader,
  storage: StorageProvider,
  cluster: "localnet" | "devnet",
  readStatus: (kathaId: string) => Promise<ArtworkRegistrationReview["registration"]>,
) {
  async function inspect(snapshot: ArtworkPublicationSnapshot) {
    const { artwork, metadata, initialReport } = snapshot;
    if (
      !metadata ||
      metadata.status === "DRAFT" ||
      !initialReport ||
      initialReport.status === "DRAFT"
    )
      return null;
    await validateArtworkDocumentation(snapshot, storage);
    const accounts = await readChain(artwork.kathaId, initialReport.id);
    const config = getKathaConfigDecoder().decode(accounts.configAccount.data);
    const state = await readArtworkMintState(
      { authorityAddress: config.registrationAuthority },
      accounts,
      artwork.kathaId,
    );
    const hex = (v: ArrayLike<number>) => Buffer.from(v).toString("hex");
    if (
      state.prepared.record.artistId !== artwork.artistId ||
      state.prepared.record.category !==
        {
          MANDALA: ArtworkCategory.Mandala,
          PAUBHA: ArtworkCategory.Paubha,
          THANGKA: ArtworkCategory.Thangka,
        }[artwork.category] ||
      state.prepared.record.creationYear !== artwork.creationYear ||
      (state.prepared.record.creatorWallet.__option === "Some"
        ? state.prepared.record.creatorWallet.value
        : null) !== artwork.creatorWallet ||
      hex(state.prepared.record.authorshipEvidenceHash) !==
        artwork.authorshipEvidenceHash ||
      state.metadata.current.uri !== metadata.uri ||
      hex(state.metadata.current.documentHash) !== metadata.documentHash ||
      (metadata.status === "FINALIZED" &&
        metadata.chainVersion !== state.metadata.state.version) ||
      hex(state.initial.reportHash) !== initialReport.documentHash ||
      state.initial.verifier !== initialReport.authorityWallet ||
      hex(state.initial.inspectorId) !== initialReport.inspectorId.replaceAll("-", "")
    )
      throw new DomainError("CONFLICT");
    return {
      asset: state.asset,
      collection: config.collection,
      collectionAuthority: config.collectionAuthority,
      registrationAuthority: config.registrationAuthority,
      owner: state.owner,
      minted: state.minted,
      metadataVersion: state.metadata.state.version,
      conditionVersion: state.condition.version,
      custodyRevision: state.custody.state.revision.toString(),
      custodyState: (
        ["UNKNOWN", "KATHA_HELD", "COLLECTOR_HELD", "IN_TRANSIT"] as const
      )[state.custody.state.state]!,
    };
  }
  const canPublish = (
    snapshot: ArtworkPublicationSnapshot,
    chain: Awaited<ReturnType<typeof inspect>>,
    mint: ArtworkRegistrationReview["registration"],
  ) =>
    Boolean(
      chain?.minted &&
      chain.owner &&
      snapshot.indexedEligible &&
      snapshot.indexedMint?.asset === chain.asset &&
      snapshot.ownership?.assetAddress === chain.asset &&
      snapshot.ownership.ownerWallet === chain.owner &&
      mint.finalized &&
      !mint.unresolved &&
      mint.receipt?.status === "FINALIZED" &&
      mint.receipt.indexed &&
      mint.receipt.signature === snapshot.indexedMint.signature,
    );
  return {
    async review(bearer: string | undefined, kathaId: string) {
      const handler = await authorization.requireRole(bearer, "admin");
      if (handler.cluster !== cluster) throw new DomainError("FORBIDDEN");
      const snapshot = await store.review(kathaId);
      if (!snapshot) throw new DomainError("NOT_FOUND");
      const mint = await readStatus(kathaId);
      let chain: Awaited<ReturnType<typeof inspect>> = null;
      try {
        chain = await inspect(snapshot);
      } catch (error) {
        if (
          !(error instanceof TypeError) &&
          !(error instanceof RegistryLifecycleError && error.code === "INVALID_INPUT")
        )
          throw error;
      }
      const blockedReasons: ReturnType<
        typeof artworkMintReviewSchema.parse
      >["blockedReasons"] = [];
      if (snapshot.artist?.verificationStatus !== "VERIFIED")
        blockedReasons.push("ARTIST_UNVERIFIED");
      if (
        !snapshot.metadata ||
        snapshot.metadata.status === "DRAFT" ||
        !snapshot.initialReport ||
        snapshot.initialReport.status === "DRAFT"
      )
        blockedReasons.push("DOCUMENTS_MISSING");
      if (!chain) blockedReasons.push("CHAIN_PREREQUISITES");
      if (
        chain &&
        !chain.minted &&
        chain.registrationAuthority !== handler.walletAddress
      )
        blockedReasons.push("AUTHORITY_REQUIRED");
      if (mint.unresolved) blockedReasons.push("UNRESOLVED_MINT");
      if (
        snapshot.reservation &&
        snapshot.reservation.walletAddress !== handler.walletAddress &&
        !chain?.minted
      )
        blockedReasons.push("OTHER_RESERVATION");
      const eligible = canPublish(snapshot, chain, mint);
      if (chain?.minted && !eligible) blockedReasons.push("INDEXING_PENDING");
      const metadata = snapshot.metadata,
        report = snapshot.initialReport;
      return artworkMintReviewSchema.parse({
        kathaId,
        cluster,
        title: snapshot.artwork.title,
        updatedAt: snapshot.artwork.updatedAt.toISOString(),
        identity: snapshot.artwork.authorshipEvidenceHash
          ? {
              artistId: snapshot.artwork.artistId,
              creatorWallet: snapshot.artwork.creatorWallet,
              category: snapshot.artwork.category,
              creationYear: snapshot.artwork.creationYear,
              authorshipEvidenceHash: snapshot.artwork.authorshipEvidenceHash,
            }
          : null,
        artistVerified: snapshot.artist?.verificationStatus === "VERIFIED",
        published: snapshot.artwork.publishedAt !== null,
        metadata:
          metadata && metadata.status !== "DRAFT"
            ? {
                id: metadata.id,
                version: metadata.version,
                status: metadata.status,
                documentHash: metadata.documentHash,
                uri: metadata.uri,
                canonicalDocument: metadata.canonicalDocument,
              }
            : null,
        initialReport:
          report && report.status !== "DRAFT"
            ? { id: report.id, documentHash: report.documentHash }
            : null,
        reservation: snapshot.reservation,
        chain,
        mint,
        blockedReasons,
        canMint: Boolean(
          chain &&
          !chain.minted &&
          !mint.finalized &&
          !snapshot.artwork.publishedAt &&
          blockedReasons.length === 0,
        ),
        canPublish: !snapshot.artwork.publishedAt && eligible,
      });
    },
    async publish(bearer: string | undefined, kathaId: string, input: unknown) {
      const handler = await authorization.requireRole(bearer, "admin");
      if (handler.cluster !== cluster) throw new DomainError("FORBIDDEN");
      const parsed = artworkPublicationRequestSchema.safeParse(input);
      if (!parsed.success) throw new DomainError("INVALID_REQUEST");
      const snapshot = await store.review(kathaId);
      if (!snapshot) throw new DomainError("NOT_FOUND");
      if (snapshot.artwork.updatedAt.toISOString() !== parsed.data.expectedUpdatedAt)
        throw new DomainError("CONFLICT");
      let chain;
      try {
        chain = await inspect(snapshot);
      } catch (error) {
        if (error instanceof TypeError || error instanceof RegistryLifecycleError)
          throw new DomainError("CONFLICT");
        throw error;
      }
      if (
        !canPublish(snapshot, chain, await readStatus(kathaId)) ||
        !chain?.owner ||
        !snapshot.indexedMint
      )
        throw new DomainError("CONFLICT");
      const saved = await store.publish(snapshot, {
        asset: chain.asset,
        owner: chain.owner,
        signature: snapshot.indexedMint.signature,
      });
      if (!saved) throw new DomainError("CONFLICT");
      return this.review(bearer, kathaId);
    },
  };
}
export type ArtworkMintAdministration = ReturnType<
  typeof createArtworkMintAdministration
>;
