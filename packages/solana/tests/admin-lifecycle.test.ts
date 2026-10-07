import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, sign, randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  signatureBytes,
  addSignersToInstruction,
  address,
  createClient,
  fetchEncodedAccount,
  generateKeyPairSigner,
  getAddressDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
} from "@solana/kit";
import { signer } from "@solana/kit-plugin-signer";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import {
  artistResponseSchema,
  artworkDraftResponseSchema,
  artworkMediaResponseSchema,
  artworkRegistrationReviewSchema,
  artworkVerificationReviewSchema,
  conditionInspectionReviewSchema,
  custodyAdministrationReviewSchema,
  artworkMintReviewSchema,
  metadataRevisionReviewSchema,
  preparedDocumentResponseSchema,
  walletChallengeResponseSchema,
  walletSessionResponseSchema,
  unsignedOperationResponseSchema,
  operationReceiptResponseSchema,
  artworkProvenanceResponseSchema,
  publicArtworkDetailSchema,
  metadataDocumentSchema,
  type UnsignedOperationResponse,
} from "@katha/shared";
import { expect, it } from "vitest";
import { buildCreateCoreCollectionInstruction, readCoreAsset } from "../src/core.js";
import { surfpoolIndexerRpc } from "./fixtures/surfpool-indexer-rpc.js";
import { buildInitializePlatformTransaction } from "../src/registration.js";
import {
  KATHA_REGISTRY_PROGRAM_ADDRESS as REGISTRY,
  findCollectionAuthorityPda,
  findArtworkPda,
  getArtworkRecordDecoder,
} from "../src/generated/registry/index.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
function wallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const bytes = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  return {
    address: getAddressDecoder().decode(bytes),
    sign: (message: Uint8Array) => new Uint8Array(sign(null, message, privateKey)),
  };
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const binding = server.address();
  if (!binding || typeof binding === "string") throw new Error("Missing test port");
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  return binding.port;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await delay(100);
  }
  child.kill("SIGKILL");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

it("onboards one artwork through the production API, PostgreSQL, Registry, Core and finalized indexer", async () => {
  // Supplied only by the owned-container runner. Never load developer .env or keys.
  const databaseUrl = process.env.KATHA_TEST_DATABASE_URL;
  const rpcUrl = process.env.KATHA_TEST_SURFPOOL_RPC;
  const wsUrl = process.env.KATHA_TEST_SURFPOOL_WS;
  if (!databaseUrl || !rpcUrl || !wsUrl) throw new Error("Run pnpm admin:test");
  const dbTarget = new URL(databaseUrl);
  if (dbTarget.hostname !== "127.0.0.1" || dbTarget.pathname !== "/katha_test")
    throw new Error("Expected owned disposable PostgreSQL");
  for (const endpoint of [rpcUrl, wsUrl])
    if (new URL(endpoint).hostname !== "127.0.0.1")
      throw new Error("Expected local Surfpool");
  const admin = wallet(),
    verifier = wallet(),
    outsider = wallet();
  const bootstrap = await generateKeyPairSigner(),
    collection = await generateKeyPairSigner();
  const client = createClient()
    .use(signer(bootstrap))
    .use(
      solanaRpc({
        rpcUrl,
        rpcSubscriptionsUrl: wsUrl,
        transactionConfig: { version: 0 },
      }),
    );
  async function rpc(method: string, params: unknown[]) {
    const response = await fetch(rpcUrl!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(5000),
    });
    const result = await response.json();
    if (result.error) throw new Error(`${method}: ${JSON.stringify(result.error)}`);
    return result.result;
  }
  // Cheatcodes are limited to bootstrap authority and synthetic SOL balances.
  await rpc("surfnet_setProgramAuthority", [REGISTRY, bootstrap.address]);
  for (const actor of [bootstrap, admin, verifier, outsider])
    await rpc("surfnet_setAccount", [actor.address, { lamports: 5_000_000_000 }]);
  const [collectionAuthority] = await findCollectionAuthorityPda();
  await client.sendTransaction([
    addSignersToInstruction(
      [collection],
      buildCreateCoreCollectionInstruction({
        collectionAddress: collection.address,
        payerAddress: bootstrap.address,
        updateAuthorityAddress: collectionAuthority,
        name: "Synthetic admin collection",
        uri: "https://katha.fun/test/collection.json",
      }),
    ),
  ]);
  const program = await fetchEncodedAccount(client.rpc, REGISTRY);
  if (!program.exists) throw new Error("Missing Registry program");
  const programDataAddress = getAddressDecoder().decode(program.data.subarray(4, 36));
  const programData = await fetchEncodedAccount(client.rpc, programDataAddress);
  const collectionAccount = await fetchEncodedAccount(client.rpc, collection.address);
  if (!programData.exists || !collectionAccount.exists)
    throw new Error("Bootstrap snapshots missing");
  const initialization = await buildInitializePlatformTransaction(
    {
      cluster: "localnet",
      feePayerAddress: bootstrap.address,
      authorityAddress: bootstrap.address,
      supportedTransactionVersions: new Set([0]),
      lifetime: (await client.rpc.getLatestBlockhash().send()).value,
      currentBlockHeight: await client.rpc.getBlockHeight().send(),
    },
    {
      programAccount: program,
      programDataAccount: programData,
      collectionAccount,
      registrationAuthority: admin.address,
      verifierAuthority: verifier.address,
      custodyAuthority: admin.address,
      treasury: bootstrap.address,
    },
  );
  await client.sendTransaction([initialization.instruction]);
  const indexerRpc = await surfpoolIndexerRpc(rpcUrl);
  const startSlot = String(await rpc("getFirstAvailableBlock", []));
  const port = await freePort(),
    origin = `http://127.0.0.1:${port}`;
  const storage = await mkdtemp(join(tmpdir(), "katha-admin-test-"));
  const environment = {
    // Explicit synthetic configuration prevents inherited developer role/config overrides.
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NO_DNA: "1",
    NODE_ENV: "test",
    API_HOST: "127.0.0.1",
    API_PORT: String(port),
    DATABASE_URL: databaseUrl,
    KATHA_CLUSTER: "localnet",
    KATHA_RPC_URL: indexerRpc.url,
    KATHA_RPC_SUBSCRIPTIONS_URL: wsUrl,
    KATHA_STORAGE_ROOT: join(storage, ".storage"),
    KATHA_ADMIN_WALLETS: admin.address,
    KATHA_VERIFIER_WALLETS: verifier.address,
    KATHA_PUBLIC_APP_ORIGIN: "http://localhost:3000",
    KATHA_PUBLIC_API_ORIGIN: origin,
  };
  const api = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: join(root, "apps/api"),
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  api.stdout!.on("data", (chunk: Buffer) => {
    logs += chunk.toString();
  });
  api.stderr!.on("data", (chunk: Buffer) => {
    logs += chunk.toString();
  });
  async function request(
    path: string,
    token?: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    return response;
  }
  async function json(
    path: string,
    token?: string,
    body?: unknown,
    expected = body === undefined ? 200 : 201,
    method?: string,
  ) {
    const response = await request(path, token, body, method);
    const value: unknown = await response.json();
    expect(response.status, `${path}: ${JSON.stringify(value)}`).toBe(expected);
    return value;
  }
  async function login(actor: ReturnType<typeof wallet>) {
    const challenge = walletChallengeResponseSchema.parse(
      await json(
        "/auth/challenge",
        undefined,
        {
          walletAddress: actor.address,
          cluster: "localnet",
        },
        201,
      ),
    );
    const input = {
      challengeId: challenge.challengeId,
      walletAddress: actor.address,
      signature: Buffer.from(actor.sign(Buffer.from(challenge.message))).toString(
        "base64",
      ),
    };
    const session = walletSessionResponseSchema.parse(
      await json("/auth/verify", undefined, input, 200),
    );
    expect((await request("/auth/verify", undefined, input)).status).toBe(401);
    return session.token;
  }
  async function index() {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/indexer.ts", collection.address, startSlot, "--once"],
      {
        cwd: join(root, "apps/api"),
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Indexer timed out")),
          30_000,
        );
        child.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timeout);
          if (code === 0) resolve();
          else reject(new Error(`Indexer failed: ${output}`));
        });
      });
    } finally {
      await stop(child);
    }
  }
  async function submit(
    operation: UnsignedOperationResponse,
    actor: ReturnType<typeof wallet>,
    token: string,
  ) {
    expect(operation.requiredSignerAddresses).toEqual([actor.address]);
    const unsigned = getTransactionDecoder().decode(
      Buffer.from(operation.transactionBase64, "base64"),
    );
    expect(
      createHash("sha256").update(new Uint8Array(unsigned.messageBytes)).digest("hex"),
    ).toBe(operation.messageHash);
    const signed = {
      ...unsigned,
      signatures: {
        [actor.address]: signatureBytes(
          actor.sign(new Uint8Array(unsigned.messageBytes)),
        ),
      },
    };
    const transactionBase64 = Buffer.from(
      getTransactionEncoder().encode(signed),
    ).toString("base64");
    const signature = await rpc("sendTransaction", [
      transactionBase64,
      { encoding: "base64", preflightCommitment: "confirmed" },
    ]);
    let finalized = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      const status = (
        await rpc("getSignatureStatuses", [
          [signature],
          { searchTransactionHistory: true },
        ])
      ).value[0];
      if (status?.err)
        throw new Error(`Synthetic transaction failed: ${JSON.stringify(status.err)}`);
      if (
        status &&
        BigInt(status.slot) <=
          BigInt(await rpc("getSlot", [{ commitment: "finalized" }]))
      ) {
        finalized = true;
        break;
      }
      await delay(100);
    }
    expect(finalized, "Transaction reached the local finalized slot").toBe(true);
    const receipt = operationReceiptResponseSchema.parse(
      await json(
        `/operations/${operation.operationId}/receipts`,
        token,
        {
          preparationId: operation.preparationId,
          transactionBase64,
        },
        200,
      ),
    );
    expect(receipt.status).toBe("FINALIZED");
    expect(receipt.signature).toBe(signature);
    const replay = operationReceiptResponseSchema.parse(
      await json(
        `/operations/${operation.operationId}/receipts`,
        token,
        {
          preparationId: operation.preparationId,
          transactionBase64,
        },
        200,
      ),
    );
    expect(replay.receiptId).toBe(receipt.receiptId);
    await index();
    return receipt;
  }
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (api.exitCode !== null) throw new Error(`API startup failed: ${logs}`);
      try {
        ready = (await request("/health/ready")).status === 200;
      } catch {
        /* Startup only. */
      }
      if (ready) break;
      await delay(100);
    }
    expect(ready, "Production API readiness").toBe(true);
    const adminToken = await login(admin),
      verifierToken = await login(verifier),
      outsiderToken = await login(outsider);
    const profile = {
      slug: `synthetic-admin-${randomUUID()}`,
      displayName: "Synthetic Nepali artist",
      biography: "Fictional Paubha artist for automated tests",
      region: "Patan",
      traditions: ["Paubha"],
    };
    expect((await request("/admin/artists", outsiderToken, profile)).status).toBe(403);
    expect((await request("/admin/artists", verifierToken, profile)).status).toBe(403);
    const artist = artistResponseSchema.parse(
      await json("/admin/artists", adminToken, profile),
    );
    expect(artist.creatorWallet).toBeNull();
    expect(
      (
        await request(`/verifier/artists/${artist.id}/verification`, adminToken, {
          confirmed: true,
        })
      ).status,
    ).toBe(403);
    await json(
      `/verifier/artists/${artist.id}/verification`,
      verifierToken,
      { confirmed: true },
      200,
    );
    const draft = artworkDraftResponseSchema.parse(
      await json("/admin/artworks", adminToken, {
        creationRequestId: randomUUID(),
        artistId: artist.id,
        category: "PAUBHA",
        title: "Synthetic Paubha",
        creationYear: 2026,
        authorshipEvidenceHash: "ab".repeat(32),
        materials: ["Cotton", "Pigment"],
        dimensions: { heightMm: 500, widthMm: 400 },
        origin: { countryCode: "NP", region: "Bagmati", locality: "Patan" },
        technique: "Hand painted",
        story: "Synthetic initial cultural story",
        meaning: "Synthetic meaning",
        culturalContext: "Synthetic Nepal cultural context",
        creationProcess: "Synthetic painting process",
      }),
    );
    const id = draft.kathaId,
      adminPath = `/admin/artworks/${id}`,
      verifierPath = `/verifier/artworks/${id}`;
    expect((await request(`/artworks/${id}`)).status).toBe(404);
    const edited = artworkDraftResponseSchema.parse(
      await json(
        adminPath,
        adminToken,
        {
          expectedUpdatedAt: draft.updatedAt,
          story: "Synthetic approved cultural story",
        },
        200,
        "PATCH",
      ),
    );
    expect(edited.kathaId).toBe(id);
    expect(
      (
        await request(
          adminPath,
          adminToken,
          { expectedUpdatedAt: draft.updatedAt, title: "Stale edit" },
          "PATCH",
        )
      ).status,
    ).toBe(409);
    // Minimal signature-valid synthetic PNG; no artist photography is loaded.
    const png = Uint8Array.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0,
      1, 8, 6, 0, 0, 0,
    ]);
    async function upload(
      path: string,
      token: string,
      updatedAt: string,
      role: "HERO" | "CONDITION",
    ) {
      const form = new FormData();
      const bytes = role === "CONDITION" ? Uint8Array.from([...png, 42]) : png;
      form.append("file", new File([bytes], "synthetic.png", { type: "image/png" }));
      form.append(
        "metadata",
        JSON.stringify({
          expectedUpdatedAt: updatedAt,
          mimeType: "image/png",
          role,
          visibility: role === "HERO" ? "PUBLIC" : "PRIVATE",
          approvedPublic: role === "HERO",
          altText: "Synthetic inspection image",
          caption: null,
        }),
      );
      const response = await fetch(`${origin}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const value: unknown = await response.json();
      expect(response.status, JSON.stringify(value)).toBe(201);
      return value;
    }
    const media = artworkMediaResponseSchema.parse(
      await upload(`${adminPath}/media`, adminToken, edited.updatedAt, "HERO"),
    );
    const metadata = preparedDocumentResponseSchema.parse(
      await json(`${adminPath}/documents/metadata`, adminToken, {
        expectedUpdatedAt: media.updatedAt,
      }),
    );
    let registration = artworkRegistrationReviewSchema.parse(
      await json(`${adminPath}/registration`, adminToken),
    );
    const registrationInput = {
      idempotencyKey: randomUUID(),
      expectedUpdatedAt: registration.updatedAt,
      metadataVersionId: metadata.id,
      supportedTransactionVersions: [0],
    };
    expect(
      (
        await request(
          `${adminPath}/operations/registration`,
          verifierToken,
          registrationInput,
        )
      ).status,
    ).toBe(403);
    const operation = unsignedOperationResponseSchema.parse(
      await json(`${adminPath}/operations/registration`, adminToken, registrationInput),
    );
    expect(
      unsignedOperationResponseSchema.parse(
        await json(
          `${adminPath}/operations/registration`,
          adminToken,
          registrationInput,
        ),
      ).operationId,
    ).toBe(operation.operationId);
    await submit(operation, admin, adminToken);
    registration = artworkRegistrationReviewSchema.parse(
      await json(`${adminPath}/registration`, adminToken),
    );
    expect(registration.registration).toMatchObject({
      finalized: true,
      receipt: { indexed: true },
    });
    const verification = artworkVerificationReviewSchema.parse(
      await json(`${verifierPath}/verification`, verifierToken),
    );
    const verificationInput = {
      idempotencyKey: randomUUID(),
      expectedUpdatedAt: verification.updatedAt,
      metadataVersionId: metadata.id,
      supportedTransactionVersions: [0],
      authenticityConfirmed: true,
      reviewedEvidenceHash: draft.authorshipEvidenceHash,
    };
    expect(
      (
        await request(
          `${verifierPath}/operations/verification`,
          adminToken,
          verificationInput,
        )
      ).status,
    ).toBe(403);
    await submit(
      unsignedOperationResponseSchema.parse(
        await json(
          `${verifierPath}/operations/verification`,
          verifierToken,
          verificationInput,
        ),
      ),
      verifier,
      verifierToken,
    );
    let condition = conditionInspectionReviewSchema.parse(
      await json(`${verifierPath}/condition`, verifierToken),
    );
    const evidence = conditionInspectionReviewSchema.parse(
      await upload(
        `${verifierPath}/condition/evidence`,
        verifierToken,
        condition.updatedAt,
        "CONDITION",
      ),
    );
    condition = conditionInspectionReviewSchema.parse(
      await json(`${verifierPath}/condition`, verifierToken),
    );
    const privateImage = evidence.media[0]!;
    expect(
      (await request(`/storage/public/${privateImage.contentHash}.png`)).status,
    ).toBe(404);
    const report = preparedDocumentResponseSchema.parse(
      await json(`${verifierPath}/documents/condition`, verifierToken, {
        expectedUpdatedAt: condition.updatedAt,
        reportId: randomUUID(),
        inspectorId: randomUUID(),
        grade: "EXCELLENT",
        reason: "INITIAL_VERIFICATION",
        inspectedAt: condition.chain.observedAt,
        reportedAt: condition.chain.observedAt,
        notes: "Synthetic private inspection notes",
        mediaIds: [privateImage.id],
      }),
    );
    condition = conditionInspectionReviewSchema.parse(
      await json(`${verifierPath}/condition`, verifierToken),
    );
    const conditionInput = {
      idempotencyKey: randomUUID(),
      expectedUpdatedAt: condition.updatedAt,
      reportId: report.id,
      expectedConditionVersion: 0,
      supportedTransactionVersions: [0],
    };
    expect(
      (
        await request(
          `${verifierPath}/operations/condition`,
          adminToken,
          conditionInput,
        )
      ).status,
    ).toBe(403);
    await submit(
      unsignedOperationResponseSchema.parse(
        await json(
          `${verifierPath}/operations/condition`,
          verifierToken,
          conditionInput,
        ),
      ),
      verifier,
      verifierToken,
    );
    let custody = custodyAdministrationReviewSchema.parse(
      await json(`${adminPath}/custody`, adminToken),
    );
    const custodyInput = {
      idempotencyKey: randomUUID(),
      expectedUpdatedAt: custody.updatedAt,
      expectedCustodyRevision: "0",
      supportedTransactionVersions: [0],
      movementConfirmed: true,
      collectorWallet: null,
      transition: { action: "ATTEST_KATHA_CUSTODY", from: "UNKNOWN", to: "KATHA_HELD" },
    };
    expect(
      (await request(`${adminPath}/operations/custody`, verifierToken, custodyInput))
        .status,
    ).toBe(403);
    await submit(
      unsignedOperationResponseSchema.parse(
        await json(`${adminPath}/operations/custody`, adminToken, custodyInput),
      ),
      admin,
      adminToken,
    );
    custody = custodyAdministrationReviewSchema.parse(
      await json(`${adminPath}/custody`, adminToken),
    );
    expect(custody.chain).toMatchObject({
      state: "KATHA_HELD",
      revision: "1",
      ownerWallet: null,
    });
    // The first metadata commitment is explicitly initialized before Core minting.
    let revision = metadataRevisionReviewSchema.parse(
      await json(`${adminPath}/metadata`, adminToken),
    );
    await submit(
      unsignedOperationResponseSchema.parse(
        await json(`${adminPath}/operations/metadata`, adminToken, {
          idempotencyKey: randomUUID(),
          expectedUpdatedAt: revision.updatedAt,
          metadataVersionId: metadata.id,
          supportedTransactionVersions: [0],
          expectedMetadataVersion: 0,
          expectedMetadataHash: null,
        }),
      ),
      admin,
      adminToken,
    );
    let mint = artworkMintReviewSchema.parse(
      await json(`${adminPath}/minting`, adminToken),
    );
    expect(mint.canMint).toBe(true);
    expect(
      (
        await request(`${adminPath}/publication`, adminToken, {
          expectedUpdatedAt: mint.updatedAt,
          publicationConfirmed: true,
        })
      ).status,
    ).toBe(409);
    const mintInput = {
      idempotencyKey: randomUUID(),
      expectedUpdatedAt: mint.updatedAt,
      metadataVersionId: metadata.id,
      initialConditionReportId: report.id,
      supportedTransactionVersions: [0],
      expectedMetadataVersion: 1,
      expectedConditionVersion: 1,
      expectedCustodyRevision: "1",
    };
    expect(
      (await request(`${adminPath}/operations/mint`, verifierToken, mintInput)).status,
    ).toBe(403);
    await submit(
      unsignedOperationResponseSchema.parse(
        await json(`${adminPath}/operations/mint`, adminToken, mintInput),
      ),
      admin,
      adminToken,
    );
    mint = artworkMintReviewSchema.parse(
      await json(`${adminPath}/minting`, adminToken),
    );
    expect(mint.canPublish, JSON.stringify(mint)).toBe(true);
    expect((await request(`/artworks/${id}`)).status).toBe(404);
    await json(
      `${adminPath}/publication`,
      adminToken,
      { expectedUpdatedAt: mint.updatedAt, publicationConfirmed: true },
      200,
    );
    const initial = publicArtworkDetailSchema.parse(await json(`/artworks/${id}`));
    expect(initial.artist.id).toBe(artist.id);
    expect(initial.creatorWallet).toBeNull();
    expect(initial.ownership.ownerWallet).toBe(admin.address);
    expect(initial.custody.state).toBe("KATHA_HELD");
    expect(initial.metadata.version).toBe(1);
    expect(initial.media).toHaveLength(1);
    expect(JSON.stringify(initial)).not.toContain("Synthetic private inspection notes");
    revision = metadataRevisionReviewSchema.parse(
      await json(`${adminPath}/metadata`, adminToken),
    );
    const originalDocument = metadataDocumentSchema.parse(
      JSON.parse(revision.current!.canonicalDocument),
    );
    const changed = {
      ...originalDocument.publicContent,
      story: "Synthetic revised cultural story",
    };
    const saveInput = {
      expectedUpdatedAt: revision.updatedAt,
      metadataVersionId: metadata.id,
      publicContent: changed,
      publicApprovalConfirmed: true,
    };
    expect(
      (await request(`${adminPath}/metadata/documents`, verifierToken, saveInput))
        .status,
    ).toBe(403);
    await json(`${adminPath}/metadata/documents`, adminToken, saveInput);
    expect(
      (await request(`${adminPath}/metadata/documents`, adminToken, saveInput)).status,
    ).toBe(409);
    expect(publicArtworkDetailSchema.parse(await json(`/artworks/${id}`)).story).toBe(
      initial.story,
    );
    revision = metadataRevisionReviewSchema.parse(
      await json(`${adminPath}/metadata`, adminToken),
    );
    await submit(
      unsignedOperationResponseSchema.parse(
        await json(`${adminPath}/operations/metadata`, adminToken, {
          idempotencyKey: randomUUID(),
          expectedUpdatedAt: revision.updatedAt,
          metadataVersionId: revision.metadata!.id,
          supportedTransactionVersions: [0],
          expectedMetadataVersion: 1,
          expectedMetadataHash: metadata.documentHash,
        }),
      ),
      admin,
      adminToken,
    );
    const final = publicArtworkDetailSchema.parse(await json(`/artworks/${id}`));
    expect(final.story).toBe(changed.story);
    expect(final.metadata.version).toBe(2);
    expect(final.metadata.documentHash).not.toBe(initial.metadata.documentHash);
    expect(final.artist).toEqual(initial.artist);
    expect(final.ownership.ownerWallet).toBe(initial.ownership.ownerWallet);
    expect(final.custody).toEqual(initial.custody);
    const core = await fetchEncodedAccount(
      client.rpc,
      address(final.chain.coreAssetAddress),
    );
    if (!core.exists) throw new Error("Missing minted Core asset");
    expect(readCoreAsset(core, core.address, collection.address).uri).toBe(
      final.metadata.uri,
    );
    const artwork = await fetchEncodedAccount(
      client.rpc,
      (await findArtworkPda({ kathaId: id }))[0],
    );
    if (!artwork.exists) throw new Error("Missing immutable Registry identity");
    expect(getArtworkRecordDecoder().decode(artwork.data).artistId).toBe(artist.id);
    const historical = await request(new URL(initial.metadata.uri).pathname);
    expect(historical.status).toBe(200);
    expect(
      createHash("sha256")
        .update(new Uint8Array(await historical.arrayBuffer()))
        .digest("hex"),
    ).toBe(initial.metadata.documentHash);
    const history = artworkProvenanceResponseSchema.parse(
      await json(`/artworks/${id}/provenance`),
    );
    await index(); // A second finalized replay cannot invent or duplicate provenance.
    expect(
      artworkProvenanceResponseSchema.parse(await json(`/artworks/${id}/provenance`))
        .items,
    ).toEqual(history.items);
    for (const path of [
      adminPath,
      `${adminPath}/metadata`,
      `${verifierPath}/condition`,
    ]) {
      expect((await request(path)).status).toBe(401);
      expect((await request(path, outsiderToken)).status).toBe(403);
    }
    expect((await request("/auth/logout", adminToken, {})).status).toBe(204);
    expect((await request(adminPath, adminToken)).status).toBe(401);
    for (const secret of [
      adminToken,
      verifierToken,
      outsiderToken,
      databaseUrl,
      dbTarget.password,
      "Synthetic private inspection notes",
    ])
      expect(logs).not.toContain(secret);
  } finally {
    await stop(api);
    await indexerRpc.close();
    await rm(storage, { recursive: true, force: true });
  }
}, 180_000);
