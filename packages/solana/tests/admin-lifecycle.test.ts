import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, sign, randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm, readFile, writeFile, chmod, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import {
  runPrimaryJourney,
  type CollectorJourneyStage,
} from "../../../scripts/test-primary-journey.mjs";
import {
  tokenProgram,
  fetchToken,
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import * as marketplace from "../src/generated/marketplace/index.js";
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
import { readListingDelegates } from "./fixtures/core-plugins.js";
import { surfpoolIndexerRpc } from "./fixtures/surfpool-indexer-rpc.js";
import { buildInitializePlatformTransaction } from "../src/registration.js";
import {
  KATHA_REGISTRY_PROGRAM_ADDRESS as REGISTRY,
  findCollectionAuthorityPda,
  findArtworkPda,
  findHeadPda,
  findInitializeCustodyHeadPda,
  findInitializeMetadataHeadPda,
  findVerificationPda,
  getConditionHeadDecoder,
  getConditionAttestationDecoder,
  ConditionReason,
  CustodyState,
  getCustodyHeadDecoder,
  getArtworkRecordDecoder,
} from "../src/generated/registry/index.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
function wallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const bytes = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  return {
    address: getAddressDecoder().decode(bytes),
    publicKey: [...bytes],
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

async function lifecycleJourney() {
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
  const primaryBrowser = process.env.KATHA_TEST_PRIMARY_BROWSER === "1";
  const payout = wallet(),
    buyerB = wallet();
  const custodyResale = process.env.KATHA_TEST_CUSTODY_RESALE === "1";
  const collectorResale = process.env.KATHA_TEST_COLLECTOR_RESALE === "1";
  const trustBoundaries = process.env.KATHA_TEST_TRUST_BOUNDARIES === "1";
  const resaleBrowser = custodyResale || collectorResale;
  const client = createClient()
    .use(signer(bootstrap))
    .use(
      solanaRpc({
        rpcUrl,
        rpcSubscriptionsUrl: wsUrl,
        transactionConfig: { version: 0 },
      }),
    )
    .use(tokenProgram());
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
  // Cheatcodes bootstrap synthetic authorities and balances. Inspection expiry
  // temporarily shortens the disposable config; other faults use the RPC bridge.
  await rpc("surfnet_setProgramAuthority", [REGISTRY, bootstrap.address]);
  for (const actor of [
    bootstrap,
    admin,
    verifier,
    outsider,
    ...(resaleBrowser ? [buyerB] : []),
  ])
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
  const webPort = await freePort();
  const webOrigin = `http://127.0.0.1:${webPort}`;
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
    KATHA_PUBLIC_APP_ORIGIN: primaryBrowser ? webOrigin : "http://localhost:3000",
    KATHA_PUBLIC_API_ORIGIN: origin,
  };
  let web: ChildProcess | undefined;
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
  async function index(expectFailure = false) {
    // A fresh local ledger can expose its first block before a finalized root.
    let ready = false;
    const throughSlot = BigInt(await rpc("getSlot", [{ commitment: "processed" }]));
    for (let attempt = 0; attempt < 300; attempt++) {
      const first = BigInt(await rpc("getFirstAvailableBlock", []));
      const finalized = BigInt(await rpc("getSlot", [{ commitment: "finalized" }]));
      if (first <= finalized && throughSlot <= finalized) {
        ready = true;
        break;
      }
      await delay(100);
    }
    expect(ready, "Local ledger has a finalized history window").toBe(true);
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
          if (code === (expectFailure ? 1 : 0)) resolve();
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
    if (primaryBrowser) {
      const mint = await generateKeyPairSigner();
      await rpc("surfnet_setProgramAuthority", [
        marketplace.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
        bootstrap.address,
      ]);
      await client.token.instructions
        .createMint({
          newMint: mint,
          decimals: 6,
          mintAuthority: bootstrap.address,
          freezeAuthority: null,
        })
        .sendTransaction();
      for (const actor of [
        admin,
        outsider,
        payout,
        bootstrap,
        ...(resaleBrowser ? [buyerB] : []),
      ])
        await client.token.instructions
          .mintToATA({
            owner: actor.address,
            mint: mint.address,
            mintAuthority: bootstrap,
            amount: actor === outsider || actor === buyerB ? 10000000n : 0n,
            decimals: 6,
          })
          .sendTransaction();
      const marketProgram = await fetchEncodedAccount(
        client.rpc,
        marketplace.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
      );
      if (!marketProgram.exists) throw new Error("Missing Marketplace program");
      const marketData = getAddressDecoder().decode(marketProgram.data.subarray(4, 36));
      await client.sendTransaction([
        await marketplace.getInitializeMarketplaceInstructionAsync({
          bootstrapAuthority: bootstrap,
          programData: marketData,
          authority: bootstrap,
          paymentMint: mint.address,
          commissionBps: 250,
          secondaryRoyaltyBps: 500,
          inspectionValiditySeconds: 2592000n,
        }),
      ]);
      const require = createRequire(join(root, "apps/web/package.json"));
      web = spawn(
        process.execPath,
        [
          require.resolve("next/dist/bin/next"),
          "start",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(webPort),
        ],
        {
          cwd: join(root, "apps/web"),
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            NODE_ENV: "production",
            KATHA_CLUSTER: "localnet",
            KATHA_PUBLIC_API_ORIGIN: origin,
            KATHA_PUBLIC_APP_ORIGIN: webOrigin,
            KATHA_PUBLIC_SOLANA_RPC_URL: rpcUrl,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      for (const stream of [web.stdout, web.stderr])
        stream!.on("data", (chunk: Buffer) => {
          logs += chunk.toString();
        });
      const balance = async (owner: typeof outsider.address) =>
        (
          await fetchToken(
            client.rpc,
            (
              await findAssociatedTokenPda({
                owner,
                mint: mint.address,
                tokenProgram: TOKEN_PROGRAM_ADDRESS,
              })
            )[0],
          )
        ).data.amount;
      let primaryDetail: ReturnType<typeof publicArtworkDetailSchema.parse> | undefined;
      let primaryHistory:
        ReturnType<typeof artworkProvenanceResponseSchema.parse> | undefined;
      let resaleDetail: typeof primaryDetail;
      let resaleHistory: typeof primaryHistory;
      let transitHistory: typeof primaryHistory;
      const immutable = new Map<string, Uint8Array>();
      async function unchanged(kathaId: string) {
        if (!primaryDetail || !primaryHistory)
          throw new Error("Primary evidence missing");
        const baseline = resaleDetail ?? primaryDetail;
        const detail = publicArtworkDetailSchema.parse(
          await json(`/artworks/${kathaId}`),
        );
        expect(detail.artist).toEqual(baseline.artist);
        expect(detail.creatorWallet).toEqual(baseline.creatorWallet);
        expect(detail.chain).toEqual(baseline.chain);
        expect(detail.custody).toEqual(baseline.custody);
        expect(detail.condition).toEqual(baseline.condition);
        expect(detail.metadata).toEqual(baseline.metadata);
        for (const [key, bytes] of immutable) {
          const current = await fetchEncodedAccount(client.rpc, address(key));
          if (!current.exists) throw new Error(`Immutable account missing: ${key}`);
          expect(
            new Uint8Array(current.data),
            `Preserved Registry account ${key}`,
          ).toEqual(bytes);
        }
        return detail;
      }
      if (trustBoundaries) await login(outsider); // Real one-use challenge replay rejection.
      async function assertUnchanged(kathaId: string) {
        await unchanged(kathaId);
        expect(await balance(outsider.address)).toBe(9000000n);
        expect(await balance(buyerB.address)).toBe(10000000n);
      }
      async function expired(kathaId: string, token: string, purchase: boolean) {
        const [configAddress] = await marketplace.findConfigPda();
        const account = await fetchEncodedAccount(client.rpc, configAddress);
        if (!account.exists) throw new Error("Marketplace config missing");
        const config = marketplace.getMarketplaceConfigDecoder().decode(account.data);
        const data = marketplace.getMarketplaceConfigEncoder().encode({
          ...config,
          inspectionValiditySeconds: 1n,
        });
        try {
          await rpc("surfnet_setAccount", [
            configAddress,
            { data: Buffer.from(data).toString("hex") },
          ]);
          const shortened = await fetchEncodedAccount(client.rpc, configAddress);
          if (!shortened.exists) throw new Error("Marketplace config missing");
          expect(new Uint8Array(shortened.data)).toEqual(new Uint8Array(data));
          if (!purchase) {
            const review = await json(`/resale/artworks/${kathaId}`, token);
            expect(review).toMatchObject({
              canList: false,
              inspection: { status: "EXPIRED" },
            });
          }
          const response = purchase
            ? await request(`/artworks/${kathaId}/purchase-quote`, token, {
                supportedTransactionVersions: [0],
              })
            : await request(`/artworks/${kathaId}/operations/listing`, token, {
                idempotencyKey: randomUUID(),
                expectedRevision: "2",
                price: "2000000",
                expiresAt: String(Math.floor(Date.now() / 1000) + 3600),
                supportedTransactionVersions: [0],
              });
          expect(response.status).toBe(409);
        } finally {
          await rpc("surfnet_setAccount", [
            configAddress,
            { data: Buffer.from(account.data).toString("hex") },
          ]);
          const restored = await fetchEncodedAccount(client.rpc, configAddress);
          expect(restored.exists, "Restored Marketplace config").toBe(true);
          if (restored.exists)
            expect(new Uint8Array(restored.data)).toEqual(new Uint8Array(account.data));
        }
        await assertUnchanged(kathaId);
      }
      await runPrimaryJourney({
        origin: webOrigin,
        apiOrigin: origin,
        actors: [admin, verifier, outsider, payout, buyerB],
        index,
        ...(trustBoundaries
          ? {
              trust: {
                async assertRejected(kathaId: string) {
                  const detail = publicArtworkDetailSchema.parse(
                    await json(`/artworks/${kathaId}`),
                  );
                  expect(detail.ownership.ownerWallet).toBe(admin.address);
                  const core = await fetchEncodedAccount(
                    client.rpc,
                    address(detail.chain.coreAssetAddress),
                  );
                  if (!core.exists) throw new Error("Core missing after rejection");
                  expect(
                    readCoreAsset(core, core.address, collection.address).owner,
                  ).toBe(admin.address);
                  expect(await balance(outsider.address)).toBe(10000000n);
                  const history = artworkProvenanceResponseSchema.parse(
                    await json(`/artworks/${kathaId}/provenance`),
                  );
                  expect(
                    history.items.filter((e) => e.type === "TRANSFER"),
                  ).toHaveLength(0);
                },
                async verify(kathaId: string, adminToken: string, ownerToken: string) {
                  if (!resaleDetail || !resaleHistory)
                    throw new Error("Approved resale snapshot missing");
                  const path = join(
                    storage,
                    ".storage",
                    "public",
                    `${resaleDetail.metadata.documentHash}.json`,
                  );
                  const original = await readFile(path);
                  const mode = (await stat(path)).mode & 0o777;
                  // Only this owned synthetic fixture is made writable for corruption.
                  await chmod(path, mode | 0o200);
                  try {
                    const corrupted = Buffer.from(original);
                    corrupted[corrupted.length - 2] =
                      corrupted[corrupted.length - 2]! ^ 1;
                    await writeFile(path, corrupted);
                    expect(
                      (await request(`/admin/artworks/${kathaId}/metadata`, adminToken))
                        .status,
                    ).toBe(409);
                    expect(
                      (await request(new URL(resaleDetail.metadata.uri).pathname))
                        .status,
                    ).not.toBe(200);
                  } finally {
                    try {
                      await writeFile(path, original);
                    } finally {
                      await chmod(path, mode);
                    }
                  }
                  const restored = await request(
                    new URL(resaleDetail.metadata.uri).pathname,
                  );
                  expect(restored.status).toBe(200);
                  expect(
                    createHash("sha256")
                      .update(new Uint8Array(await restored.arrayBuffer()))
                      .digest("hex"),
                  ).toBe(resaleDetail.metadata.documentHash);
                  const [artwork] = await findArtworkPda({ kathaId });
                  indexerRpc.setFault({ kind: "ACCOUNT_OWNER", address: artwork });
                  try {
                    const response = await request(
                      `/resale/artworks/${kathaId}`,
                      ownerToken,
                    );
                    expect(response.status).toBe(500);
                    const error = await response.json();
                    expect(error).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
                    for (const text of [
                      ownerToken,
                      databaseUrl,
                      "TypeError",
                      "program owner",
                    ])
                      expect(JSON.stringify(error)).not.toContain(text);
                  } finally {
                    indexerRpc.setFault(null);
                  }
                  await expired(kathaId, ownerToken, false);
                  indexerRpc.setFault({ kind: "UNAVAILABLE" });
                  try {
                    const response = await request(
                      `/resale/artworks/${kathaId}`,
                      ownerToken,
                    );
                    expect(response.status).toBe(500);
                    const error = await response.text();
                    for (const privateText of [
                      ownerToken,
                      adminToken,
                      databaseUrl,
                      "Synthetic RPC outage",
                    ])
                      expect(error).not.toContain(privateText);
                    await index(true); // A separate real worker must fail rather than advance.
                    const afterFailure = artworkProvenanceResponseSchema.parse(
                      await json(`/artworks/${kathaId}/provenance`),
                    );
                    expect(afterFailure.items).toEqual(resaleHistory.items);
                    expect(afterFailure.indexing.streams).toEqual(
                      resaleHistory.indexing.streams,
                    );
                  } finally {
                    indexerRpc.setFault(null);
                  }
                  await index(); // Restart the real worker on its persisted checkpoints.
                  await index(); // Replay remains idempotent after recovery.
                  expect(
                    artworkProvenanceResponseSchema.parse(
                      await json(`/artworks/${kathaId}/provenance`),
                    ).items,
                  ).toEqual(resaleHistory.items);
                  await assertUnchanged(kathaId);
                  for (const privateText of [
                    ownerToken,
                    adminToken,
                    databaseUrl,
                    dbTarget.password,
                    "Synthetic RPC outage",
                  ])
                    expect(logs).not.toContain(privateText);
                },
                async verifyExpiredPurchase(kathaId: string, buyerToken: string) {
                  await expired(kathaId, buyerToken, true);
                },
              },
            }
          : {}),
        signTransaction(actor, bytes) {
          const identity = [admin, verifier, outsider, undefined, buyerB][actor];
          if (!identity) throw new Error("Unexpected synthetic signer");
          const tx = getTransactionDecoder().decode(Uint8Array.from(bytes));
          if (Object.keys(tx.signatures).some((a) => a !== identity.address))
            throw new Error("Unexpected signers");
          return [
            ...getTransactionEncoder().encode({
              ...tx,
              signatures: {
                [identity.address]: signatureBytes(
                  identity.sign(new Uint8Array(tx.messageBytes)),
                ),
              },
            }),
          ];
        },
        async waitForClock() {
          // A newly saved report uses wall time. Wait for the real chain
          // clock rather than weakening the no-future-report validation.
          const target = BigInt(Math.floor(Date.now() / 1000));
          for (let attempt = 0; attempt < 40; attempt++) {
            const clock = await fetchEncodedAccount(
              client.rpc,
              address("SysvarC1ock11111111111111111111111111111111"),
            );
            if (!clock.exists) throw new Error("Chain clock missing");
            const time = new DataView(Uint8Array.from(clock.data).buffer).getBigInt64(
              32,
              true,
            );
            if (time >= target) return;
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          throw new Error("Chain clock did not reach the saved report time");
        },
        async initializeSaleTerms(kathaId) {
          const [artwork] = await findArtworkPda({ kathaId });
          await client.sendTransaction([
            await marketplace.getInitializeSaleTermsInstructionAsync({
              artwork,
              authority: bootstrap,
              artistPayout: payout.address,
            }),
          ]);
          await index();
        },
        ...(collectorResale
          ? {
              collectorDelivery: {
                async assertState(kathaId: string, stage: CollectorJourneyStage) {
                  if (!primaryDetail || !primaryHistory)
                    throw new Error("Primary snapshot missing");
                  const stages = {
                    IN_TRANSIT_A: {
                      revision: 2n,
                      state: CustodyState.InTransit,
                      owner: outsider.address,
                      holder: null,
                      version: 1,
                      reason: ConditionReason.InitialVerification,
                    },
                    RECEIPT_A: {
                      revision: 2n,
                      state: CustodyState.InTransit,
                      owner: outsider.address,
                      holder: null,
                      version: 1,
                      reason: ConditionReason.InitialVerification,
                    },
                    HELD_A: {
                      revision: 3n,
                      state: CustodyState.CollectorHeld,
                      owner: outsider.address,
                      holder: outsider.address,
                      version: 1,
                      reason: ConditionReason.InitialVerification,
                    },
                    POST_DELIVERY_A: {
                      revision: 3n,
                      state: CustodyState.CollectorHeld,
                      owner: outsider.address,
                      holder: outsider.address,
                      version: 2,
                      reason: ConditionReason.PostDelivery,
                    },
                    APPROVED_A: {
                      revision: 3n,
                      state: CustodyState.CollectorHeld,
                      owner: outsider.address,
                      holder: outsider.address,
                      version: 3,
                      reason: ConditionReason.PreResale,
                    },
                    SOLD_HELD_A: {
                      revision: 3n,
                      state: CustodyState.CollectorHeld,
                      owner: buyerB.address,
                      holder: outsider.address,
                      version: 3,
                      reason: ConditionReason.PreResale,
                    },
                    IN_TRANSIT_B: {
                      revision: 4n,
                      state: CustodyState.InTransit,
                      owner: buyerB.address,
                      holder: null,
                      version: 3,
                      reason: ConditionReason.PreResale,
                    },
                    HELD_B: {
                      revision: 5n,
                      state: CustodyState.CollectorHeld,
                      owner: buyerB.address,
                      holder: buyerB.address,
                      version: 3,
                      reason: ConditionReason.PreResale,
                    },
                    POST_DELIVERY_B: {
                      revision: 5n,
                      state: CustodyState.CollectorHeld,
                      owner: buyerB.address,
                      holder: buyerB.address,
                      version: 4,
                      reason: ConditionReason.PostDelivery,
                    },
                  };
                  const expected = stages[stage];
                  const detail = publicArtworkDetailSchema.parse(
                    await json(`/artworks/${kathaId}`),
                  );
                  const history = artworkProvenanceResponseSchema.parse(
                    await json(`/artworks/${kathaId}/provenance`),
                  );
                  expect(detail.artist).toEqual(primaryDetail.artist);
                  expect(detail.metadata).toEqual(primaryDetail.metadata);
                  expect(detail.chain).toEqual(primaryDetail.chain);
                  expect(detail.ownership.ownerWallet).toBe(expected.owner);
                  expect(detail.custody.state).toBe(
                    expected.state === CustodyState.InTransit
                      ? "IN_TRANSIT"
                      : "COLLECTOR_HELD",
                  );
                  expect(detail.condition?.version).toBe(expected.version);
                  const [artwork] = await findArtworkPda({ kathaId });
                  const [custodyKey] = await findInitializeCustodyHeadPda({ artwork });
                  const [conditionKey] = await findHeadPda({ artwork });
                  const custody = await fetchEncodedAccount(client.rpc, custodyKey);
                  const condition = await fetchEncodedAccount(client.rpc, conditionKey);
                  if (!custody.exists || !condition.exists)
                    throw new Error("Custody/condition missing");
                  const head = getCustodyHeadDecoder().decode(custody.data);
                  expect(head).toMatchObject({
                    revision: expected.revision,
                    state: expected.state,
                  });
                  expect(head.subject).toEqual(
                    expected.holder
                      ? { __option: "Some", value: expected.holder }
                      : { __option: "None" },
                  );
                  const reportHead = getConditionHeadDecoder().decode(condition.data);
                  expect(reportHead.version).toBe(expected.version);
                  const reportAccount = await fetchEncodedAccount(
                    client.rpc,
                    reportHead.currentReport,
                  );
                  if (!reportAccount.exists)
                    throw new Error("Condition report missing");
                  const report = getConditionAttestationDecoder().decode(
                    reportAccount.data,
                  );
                  expect(report.reason).toBe(expected.reason);
                  if (expected.version > 1) {
                    expect(report.ownerScope).toEqual({
                      __option: "Some",
                      value: expected.version === 4 ? buyerB.address : outsider.address,
                    });
                    expect(report.custodyRevisionScope).toEqual({
                      __option: "Some",
                      value: expected.version === 4 ? 5n : 3n,
                    });
                  }
                  const core = await fetchEncodedAccount(
                    client.rpc,
                    address(detail.chain.coreAssetAddress),
                  );
                  if (!core.exists) throw new Error("Core asset missing");
                  const view = readCoreAsset(core, core.address, collection.address);
                  expect(view.owner).toBe(expected.owner);
                  expect(view.uri).toBe(primaryDetail.metadata.uri);
                  if (stage === "IN_TRANSIT_A") transitHistory = history;
                  if (stage === "RECEIPT_A")
                    expect(history.items).toEqual(transitHistory!.items);
                  if (stage === "POST_DELIVERY_A" || stage === "APPROVED_A")
                    immutable.set(
                      reportHead.currentReport,
                      new Uint8Array(reportAccount.data),
                    );
                  if (stage === "APPROVED_A") {
                    resaleDetail = detail;
                    resaleHistory = history;
                    immutable.set(custodyKey, new Uint8Array(custody.data));
                    immutable.set(conditionKey, new Uint8Array(condition.data));
                    const transition = await fetchEncodedAccount(
                      client.rpc,
                      head.latestTransition,
                    );
                    if (!transition.exists)
                      throw new Error("Custody transition missing");
                    immutable.set(
                      head.latestTransition,
                      new Uint8Array(transition.data),
                    );
                  }
                  for (const text of [
                    "Private Test Lane",
                    "synthetic-collector@example.invalid",
                    "PRIVATE-TEST-TRACKING",
                    "Synthetic private",
                  ]) {
                    expect(JSON.stringify(history)).not.toContain(text);
                    expect(JSON.stringify(detail)).not.toContain(text);
                    expect(logs).not.toContain(text);
                  }
                  if (stage === "POST_DELIVERY_B") {
                    for (const [key, bytes] of immutable) {
                      if (key === custodyKey || key === conditionKey) continue;
                      const account = await fetchEncodedAccount(
                        client.rpc,
                        address(key),
                      );
                      if (!account.exists)
                        throw new Error("Historical account missing");
                      expect(new Uint8Array(account.data)).toEqual(bytes);
                    }
                    expect(
                      history.items.filter((e) => e.type === "TRANSFER"),
                    ).toHaveLength(2);
                    expect(
                      history.items.filter((e) => e.type === "CONDITION"),
                    ).toHaveLength(4);
                    expect(
                      history.items.filter((e) => e.type === "CUSTODY"),
                    ).toHaveLength(5);
                    await index();
                    expect(
                      artworkProvenanceResponseSchema.parse(
                        await json(`/artworks/${kathaId}/provenance`),
                      ).items,
                    ).toEqual(history.items);
                    expect(await balance(outsider.address)).toBe(10850000n);
                    expect(await balance(buyerB.address)).toBe(8000000n);
                    expect(await balance(payout.address)).toBe(1075000n);
                    expect(await balance(bootstrap.address)).toBe(75000n);
                  }
                },
              },
            }
          : {}),
        ...(resaleBrowser
          ? {
              custodyResale: {
                async assertListed(kathaId: string) {
                  const detail = await unchanged(kathaId);
                  const core = await fetchEncodedAccount(
                    client.rpc,
                    address(detail.chain.coreAssetAddress),
                  );
                  if (!core.exists) throw new Error("Listed Core asset missing");
                  const [listing] = await marketplace.findListingPda({
                    asset: core.address,
                  });
                  expect(readListingDelegates(core)).toEqual({
                    owner: outsider.address,
                    freeze: { frozen: true, authority: "Address", address: listing },
                    transfer: { authority: "Address", address: listing },
                  });
                  expect(await balance(outsider.address)).toBe(9000000n);
                  expect(await balance(buyerB.address)).toBe(10000000n);
                  const history = artworkProvenanceResponseSchema.parse(
                    await json(`/artworks/${kathaId}/provenance`),
                  );
                  expect(history.items).toEqual(
                    (resaleHistory ?? primaryHistory)!.items,
                  );
                },
                async assertResale(kathaId: string) {
                  const detail = await unchanged(kathaId);
                  expect(detail.ownership.ownerWallet).toBe(buyerB.address);
                  const core = await fetchEncodedAccount(
                    client.rpc,
                    address(detail.chain.coreAssetAddress),
                  );
                  if (!core.exists) throw new Error("Purchased Core asset missing");
                  expect(
                    readCoreAsset(core, core.address, collection.address).owner,
                  ).toBe(buyerB.address);
                  expect(readListingDelegates(core)).toEqual({
                    owner: buyerB.address,
                    freeze: { frozen: false, authority: "Owner", address: null },
                    transfer: { authority: "Owner", address: null },
                  });
                  expect(await balance(outsider.address)).toBe(10850000n);
                  expect(await balance(buyerB.address)).toBe(8000000n);
                  expect(await balance(payout.address)).toBe(1075000n);
                  expect(await balance(bootstrap.address)).toBe(75000n);
                  const [listing] = await marketplace.findListingPda({
                    asset: core.address,
                  });
                  const ledger = await fetchEncodedAccount(client.rpc, listing);
                  if (!ledger.exists) throw new Error("Completed listing missing");
                  expect(
                    marketplace.getListingRecordDecoder().decode(ledger.data),
                  ).toMatchObject({
                    status: marketplace.ListingStatus.Purchased,
                    revision: 4n,
                    completedSales: 2n,
                    saleKind: marketplace.SaleKind.Secondary,
                  });
                  const history = artworkProvenanceResponseSchema.parse(
                    await json(`/artworks/${kathaId}/provenance`),
                  );
                  expect(history.items).toHaveLength(
                    (resaleHistory ?? primaryHistory)!.items.length + 1,
                  );
                  expect(history.items.slice(0, -1)).toEqual(
                    (resaleHistory ?? primaryHistory)!.items,
                  );
                  expect(
                    history.items.filter((e) => e.type === "TRANSFER"),
                  ).toHaveLength(2);
                  expect(history.items.at(-1)).toMatchObject({
                    type: "TRANSFER",
                    data: {
                      newOwner: buyerB.address,
                      sale: {
                        isPrimary: false,
                        listingRevision: "3",
                        sellerWallet: outsider.address,
                        buyerWallet: buyerB.address,
                        price: "2000000",
                        proceedsAmount: "1850000",
                        royaltyAmount: "100000",
                        platformFee: "50000",
                      },
                    },
                  });
                  expect(JSON.stringify(history)).not.toContain(
                    "Synthetic private inspection notes",
                  );
                  await index();
                  expect(
                    artworkProvenanceResponseSchema.parse(
                      await json(`/artworks/${kathaId}/provenance`),
                    ).items,
                  ).toEqual(history.items);
                },
              },
            }
          : {}),
        async assertPurchase(kathaId, artistId) {
          const detail = publicArtworkDetailSchema.parse(
            await json(`/artworks/${kathaId}`),
          );
          expect(detail.artist.id).toBe(artistId);
          expect(detail.creatorWallet).toBeNull();
          const [recordAddress] = await findArtworkPda({ kathaId });
          const registryRecord = await fetchEncodedAccount(client.rpc, recordAddress);
          if (!registryRecord.exists) throw new Error("Registry artwork missing");
          expect(getArtworkRecordDecoder().decode(registryRecord.data).artistId).toBe(
            artistId,
          );
          expect(detail.ownership.ownerWallet).toBe(outsider.address);
          expect(detail.custody.state).toBe("KATHA_HELD");
          const asset = await fetchEncodedAccount(
            client.rpc,
            address(detail.chain.coreAssetAddress),
          );
          if (!asset.exists) throw new Error("Core asset missing");
          expect(readCoreAsset(asset, asset.address, collection.address).owner).toBe(
            outsider.address,
          );
          expect(await balance(outsider.address)).toBe(9000000n);
          expect(await balance(payout.address)).toBe(975000n);
          expect(await balance(bootstrap.address)).toBe(25000n);
          const history = artworkProvenanceResponseSchema.parse(
            await json(`/artworks/${kathaId}/provenance`),
          );
          expect(history.items.filter((e) => e.type === "MINT")).toHaveLength(1);
          expect(history.items.find((e) => e.type === "REGISTRATION")).toMatchObject({
            data: { artistId },
          });
          expect(history.items.filter((e) => e.type === "TRANSFER")).toHaveLength(1);
          expect(history.items.find((e) => e.type === "TRANSFER")).toMatchObject({
            data: { sale: { isPrimary: true, price: "1000000" } },
          });
          expect(JSON.stringify(history)).not.toContain(
            "Synthetic private inspection notes",
          );
          if (resaleBrowser) {
            primaryDetail = detail;
            primaryHistory = history;
            const [conditionHead] = await findHeadPda({ artwork: recordAddress });
            const [custodyHead] = await findInitializeCustodyHeadPda({
              artwork: recordAddress,
            });
            const [metadataHead] = await findInitializeMetadataHeadPda({
              artwork: recordAddress,
            });
            const [verification] = await findVerificationPda({
              artwork: recordAddress,
            });
            const condition = await fetchEncodedAccount(client.rpc, conditionHead);
            const custody = await fetchEncodedAccount(client.rpc, custodyHead);
            if (!condition.exists || !custody.exists)
              throw new Error("Attestation heads missing");
            const currentReport = getConditionHeadDecoder().decode(
              condition.data,
            ).currentReport;
            const custodyState = getCustodyHeadDecoder().decode(custody.data);
            expect(custodyState.revision).toBe(1n);
            for (const key of [
              recordAddress,
              conditionHead,
              currentReport,
              custodyHead,
              custodyState.latestTransition,
              metadataHead,
              verification,
            ]) {
              const account = await fetchEncodedAccount(client.rpc, key);
              if (!account.exists)
                throw new Error("Preserved Registry account missing");
              immutable.set(key, new Uint8Array(account.data));
            }
            expect(await balance(buyerB.address)).toBe(10000000n);
          }
          await index();
          expect(
            artworkProvenanceResponseSchema.parse(
              await json(`/artworks/${kathaId}/provenance`),
            ).items,
          ).toEqual(history.items);
        },
      });
      return;
    }
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
      transition: {
        action: "ATTEST_KATHA_CUSTODY",
        from: "UNKNOWN",
        to: "KATHA_HELD",
      },
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
    if (web) await stop(web);
    await stop(api);
    await indexerRpc.close();
    await rm(storage, { recursive: true, force: true });
  }
}

it(
  process.env.KATHA_TEST_TRUST_BOUNDARIES === "1"
    ? "recovers the complete browser lifecycle after authorization, integrity and RPC failures"
    : process.env.KATHA_TEST_COLLECTOR_RESALE === "1"
      ? "inspects and resells collector-held artwork through actual browser delivery coordination"
      : process.env.KATHA_TEST_CUSTODY_RESALE === "1"
        ? "resells through two browser wallets while preserving Katha custody and history"
        : process.env.KATHA_TEST_PRIMARY_BROWSER === "1"
          ? "collects an artwork through the production browser, API, local programs and finalized indexer"
          : "onboards one artwork through the production API, PostgreSQL, Registry, Core and finalized indexer",
  lifecycleJourney,
  process.env.KATHA_TEST_COLLECTOR_RESALE === "1"
    ? 720_000
    : process.env.KATHA_TEST_PRIMARY_BROWSER === "1"
      ? 480_000
      : 300_000,
);
