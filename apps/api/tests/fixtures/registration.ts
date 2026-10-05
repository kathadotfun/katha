import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { canonicalDocumentBytes, sha256Hex, type WalletSession } from "@katha/shared";
import type {
  ArtworkRegistrationStore,
  ArtworkRegistrationSnapshot,
  OperationPreparationStore,
} from "@katha/db";
import {
  encodeUnsignedRegistryTransaction,
  type RegistryTransactionContext,
  type OperationChain,
  type ArtworkRegistrationReader,
} from "@katha/solana";
import {
  findConfigPda,
  findCollectionAuthorityPda,
  findArtworkPda,
  getKathaConfigEncoder,
  KATHA_REGISTRY_PROGRAM_ADDRESS as REGISTRY,
} from "@katha/solana/registry";
import { createAuthorization } from "../../src/authorization.js";
import { createArtworkRegistration } from "../../src/artwork-registration.js";
import { DomainError } from "../../src/errors.js";
import type { StorageProvider } from "../../src/storage.js";
import { temporaryWallet } from "./wallet.js";

export async function registrationFixture() {
  const wallet = temporaryWallet().address;
  const at = new Date("2026-10-05T00:00:00.000Z");
  const artistId = randomUUID();
  const artworkId = randomUUID();
  const document = {
    schemaVersion: 1,
    kathaId: "KATHA-PAUBHA-000001",
    name: "Synthetic artwork",
    category: "PAUBHA",
    artist: { artistId, displayName: "Synthetic Artist", creatorWallet: null },
    creationYear: 2026,
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
  const bytes = canonicalDocumentBytes(document);
  const hash = await sha256Hex(bytes);
  const snapshot: ArtworkRegistrationSnapshot = {
    registered: false,
    artwork: {
      id: artworkId,
      kathaId: document.kathaId,
      creationRequestId: null,
      artistId,
      category: "PAUBHA",
      creatorWallet: null,
      title: document.name,
      creationYear: 2026,
      authorshipEvidenceHash: "e".repeat(64),
      heightMm: 100,
      widthMm: 100,
      depthMm: null,
      originCountryCode: "NP",
      originRegion: "Bagmati",
      originLocality: null,
      technique: document.technique,
      ...document.publicContent,
      publishedAt: null,
      createdAt: at,
      updatedAt: at,
    },
    artist: {
      id: artistId,
      slug: "synthetic-artist",
      displayName: "Synthetic Artist",
      biography: "PRIVATE ARTIST BIO",
      region: "Bagmati",
      traditions: ["Paubha"],
      publicLinks: [],
      profileImageUrl: null,
      creatorWallet: null,
      payoutWallet: wallet,
      verificationStatus: "VERIFIED",
      verifiedAt: at,
      verifiedByWallet: wallet,
      createdAt: at,
      updatedAt: at,
    },
    metadata: {
      id: randomUUID(),
      artworkId,
      version: 1,
      chainVersion: null,
      status: "PREPARED",
      authorityWallet: wallet,
      canonicalDocument: new TextDecoder().decode(bytes),
      documentHash: hash,
      uri: `http://localhost:3001/storage/public/${hash}.json`,
      chainCluster: null,
      chainSignature: null,
      chainSlot: null,
      chainRecordedAt: null,
      finalizedAt: null,
      createdAt: at,
      updatedAt: at,
    },
  };
  const load = vi.fn<ArtworkRegistrationStore["load"]>(async () => snapshot);
  const save = vi.fn<OperationPreparationStore["save"]>(async () => ({
    status: "saved",
    operationId: randomUUID(),
    preparationId: randomUUID(),
  }));
  const store: ArtworkRegistrationStore = { load, operations: () => ({ save }) };
  const session: WalletSession = {
    walletId: randomUUID(),
    walletAddress: wallet,
    cluster: "localnet",
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const authorities = {
    authority: wallet,
    registrationAuthority: wallet,
    verifierAuthority: wallet,
    custodyAuthority: wallet,
  };
  const authenticate = vi.fn(async (bearer) => {
    if (bearer !== "Bearer synthetic") throw new DomainError("UNAUTHENTICATED");
    return session;
  });
  const readAuthorities = vi.fn(async () => authorities);
  const authorization = createAuthorization(
    { authenticate },
    { cluster: "localnet", adminWallets: [wallet], verifierWallets: [] },
    readAuthorities,
  );
  const [config, bump] = await findConfigPda();
  const [collectionAuthority, collectionAuthorityBump] =
    await findCollectionAuthorityPda();
  const data = Uint8Array.from(
    getKathaConfigEncoder().encode({
      authority: wallet as never,
      registrationAuthority: wallet as never,
      verifierAuthority: wallet as never,
      custodyAuthority: wallet as never,
      treasury: wallet as never,
      collection: wallet as never,
      collectionAuthority,
      bump,
      collectionAuthorityBump,
    }),
  );
  const [artworkAddress] = await findArtworkPda({ kathaId: document.kathaId });
  const readChain = vi.fn<ArtworkRegistrationReader>(async () => ({
    configAccount: {
      address: config,
      programAddress: REGISTRY,
      data,
      space: BigInt(data.length),
      lamports: 1n as Awaited<
        ReturnType<ArtworkRegistrationReader>
      >["configAccount"]["lamports"],
      executable: false,
      exists: true as const,
    },
    artworkAddress,
    artworkExists: false,
  }));
  const context = vi.fn(
    async () =>
      ({
        cluster: "localnet",
        authorityAddress: wallet,
        feePayerAddress: wallet,
        lifetime: {
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: 100n,
        },
        currentBlockHeight: 50n,
        supportedTransactionVersions: new Set([0]),
      }) as unknown as RegistryTransactionContext,
  );
  const simulate = vi.fn<OperationChain["simulate"]>(async (prepared) => ({
    ...(await encodeUnsignedRegistryTransaction(prepared)),
    simulation: { slot: "20", unitsConsumed: "5000" },
  }));
  const chain: OperationChain = { context, simulate };
  const read = vi.fn<StorageProvider["read"]>(async () => bytes);
  const storage: StorageProvider = {
    read,
    put: async () => {
      throw new Error("No writes expected");
    },
  };
  const service = createArtworkRegistration(
    store,
    authorization,
    readChain,
    chain,
    storage,
    "localnet",
  );
  const request = {
    idempotencyKey: "synthetic-registration",
    expectedUpdatedAt: at.toISOString(),
    metadataVersionId: snapshot.metadata!.id,
    supportedTransactionVersions: [0],
  };
  return {
    service,
    request,
    snapshot,
    store,
    load,
    save,
    session,
    authorities,
    readAuthorities,
    authorization,
    readChain,
    context,
    simulate,
    read,
    bytes,
    document,
    storage,
    chain,
  };
}
