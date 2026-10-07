import {
  metadataRevisionReviewSchema,
  metadataRevisionDocumentRequestSchema,
  canonicalDocumentBytes,
  metadataDocumentSchema,
  sha256Hex,
} from "@katha/shared";
import type { MetadataAdministrationStore, MetadataRevisionStore } from "@katha/db";
import { readMetadataRevisionState, type MetadataRevisionReader } from "@katha/solana";
import { ArtworkCategory } from "@katha/solana/registry";
import type { AuthorizationBoundary } from "./authorization.js";
import type { StorageProvider } from "./storage.js";
import { storedObjectSchema } from "./storage.js";
import { validateArtworkDocumentation } from "./artwork-documentation.js";
import { DomainError } from "./errors.js";
export function createMetadataAdministration(
  revisions: MetadataRevisionStore,
  store: MetadataAdministrationStore,
  authorization: AuthorizationBoundary,
  readChain: MetadataRevisionReader,
  storage: StorageProvider,
  cluster: "localnet" | "devnet",
  publicApiOrigin: string,
  status: (kathaId: string, metadataId: string) => Promise<unknown>,
) {
  async function review(bearer: string | undefined, kathaId: string) {
    const session = await authorization.requireRole(bearer, "admin");
    if (session.cluster !== cluster) throw new DomainError("FORBIDDEN");
    const snapshot = await revisions.load(kathaId);
    if (!snapshot) throw new DomainError("NOT_FOUND");
    const { artwork: a, metadata, artist } = snapshot;
    if (!metadata || !["PREPARED", "FINALIZED"].includes(metadata.status))
      throw new DomainError("CONFLICT");
    await validateArtworkDocumentation(snapshot, storage);
    let live;
    try {
      live = await readMetadataRevisionState(await readChain(kathaId), kathaId);
    } catch (error) {
      if (error instanceof TypeError) throw new DomainError("CONFLICT");
      throw error;
    }
    const record = live.prepared.record;
    if (
      record.artistId !== a.artistId ||
      record.category !==
        ArtworkCategory[
          { MANDALA: "Mandala", PAUBHA: "Paubha", THANGKA: "Thangka" }[a.category] as
            "Mandala" | "Paubha" | "Thangka"
        ] ||
      record.creationYear !== a.creationYear ||
      (record.creatorWallet.__option === "Some" ? record.creatorWallet.value : null) !==
        a.creatorWallet ||
      Buffer.from(record.authorshipEvidenceHash).toString("hex") !==
        a.authorshipEvidenceHash
    )
      throw new DomainError("CONFLICT");
    const current = await store.current(kathaId);
    if (current)
      await validateArtworkDocumentation({ ...snapshot, metadata: current }, storage);
    if (current?.canonicalDocument && metadata.canonicalDocument) {
      const before = metadataDocumentSchema.parse(
        JSON.parse(current.canonicalDocument),
      );
      const after = metadataDocumentSchema.parse(
        JSON.parse(metadata.canonicalDocument),
      );
      if (
        new TextDecoder().decode(
          canonicalDocumentBytes({ ...before, publicContent: {} }),
        ) !==
        new TextDecoder().decode(
          canonicalDocumentBytes({ ...after, publicContent: {} }),
        )
      )
        throw new DomainError("CONFLICT");
    }

    const project = (row: typeof metadata) => ({
      id: row.id,
      version: row.version,
      status: row.status,
      documentHash: row.documentHash,
      uri: row.uri,
      canonicalDocument: row.canonicalDocument,
    });
    const revision = await status(kathaId, metadata.id);
    const matched =
      live.chain.version === 0
        ? current === null
        : current?.chainVersion === live.chain.version &&
          current.documentHash === live.chain.documentHash &&
          current.uri === live.chain.uri;
    const page = metadataRevisionReviewSchema.parse({
      kathaId,
      cluster,
      updatedAt: a.updatedAt.toISOString(),
      title: a.title,
      identity: {
        artistId: a.artistId,
        category: a.category,
        creationYear: a.creationYear,
        creatorWallet: a.creatorWallet,
        authorshipEvidenceHash: a.authorshipEvidenceHash,
      },
      artistVerified: artist?.verificationStatus === "VERIFIED",
      published: a.publishedAt !== null,
      metadata: project(metadata),
      current: current ? project(current) : null,
      chain: live.chain,
      revision,
      canSave: false,
      canSubmit: false,
    });
    const eligible =
      matched &&
      page.artistVerified &&
      !page.revision.unresolved &&
      (page.revision.receipt?.status !== "FINALIZED" ||
        page.revision.receipt.indexed) &&
      live.chain.version < 4294967295;
    page.canSave = eligible;
    page.canSubmit =
      eligible &&
      live.chain.registrationAuthority === session.walletAddress &&
      metadata.status === "PREPARED" &&
      metadata.documentHash !== live.chain.documentHash;
    return { page, snapshot };
  }
  return {
    async review(bearer: string | undefined, kathaId: string) {
      return (await review(bearer, kathaId)).page;
    },
    async save(bearer: string | undefined, kathaId: string, input: unknown) {
      const parsed = metadataRevisionDocumentRequestSchema.safeParse(input);
      if (!parsed.success) throw new DomainError("INVALID_REQUEST");
      const session = await authorization.requireRole(bearer, "admin");
      const { page, snapshot } = await review(bearer, kathaId);
      const request = parsed.data;
      if (
        !page.canSave ||
        request.expectedUpdatedAt !== page.updatedAt ||
        request.metadataVersionId !== page.metadata?.id
      )
        throw new DomainError("CONFLICT");
      const original = metadataDocumentSchema.parse(
        JSON.parse(page.metadata.canonicalDocument),
      );
      const next = metadataDocumentSchema.parse({
        ...original,
        publicContent: request.publicContent,
      });
      const bytes = canonicalDocumentBytes(next),
        documentHash = await sha256Hex(bytes);
      if (documentHash === page.metadata.documentHash)
        throw new DomainError("CONFLICT");
      const saved = await store.save(snapshot, session.walletAddress, async () => {
        const ref = storedObjectSchema.parse(
          await storage.put({
            bytes,
            mimeType: "application/json",
            visibility: "PUBLIC",
          }),
        );
        if (
          ref.contentHash !== documentHash ||
          ref.visibility !== "PUBLIC" ||
          ref.byteSize !== String(bytes.length)
        )
          throw new DomainError("CONFLICT");
        const read = await storage.read(ref);
        if (
          (await sha256Hex(read)) !== documentHash ||
          !read.every((v, i) => v === bytes[i]) ||
          read.length !== bytes.length
        )
          throw new DomainError("CONFLICT");
        const uri = new URL(`/storage/${ref.storageKey}`, publicApiOrigin).href;
        if (Buffer.byteLength(uri) > 200) throw new DomainError("CONFLICT");
        return {
          canonicalDocument: new TextDecoder().decode(bytes),
          documentHash,
          uri,
        };
      });
      if (!saved) throw new DomainError("CONFLICT");
      return (await review(bearer, kathaId)).page;
    },
  };
}
