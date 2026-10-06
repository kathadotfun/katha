import type { NfcResolutionBoundary } from "./nfc-resolution.js";
import { nfcResolutionQuerySchema } from "@katha/shared";
import type { NfcTagsBoundary } from "./nfc-tags.js";
import {
  nfcArtworkParamsSchema,
  nfcTagParamsSchema,
  nfcTagAssignmentRequestSchema,
  nfcTagRetirementRequestSchema,
} from "@katha/shared";
import type { ArtworkProvenanceBoundary } from "./artwork-provenance.js";
import {
  artworkProvenanceParamsSchema,
  artworkProvenanceQuerySchema,
} from "@katha/shared";
import type { OperationReceiptsBoundary } from "./operation-receipts.js";
import {
  operationReceiptParamsSchema,
  operationReceiptRequestSchema,
} from "@katha/shared";
import type { MetadataRevisionsBoundary } from "./metadata-revisions.js";
import { metadataRevisionRequestSchema } from "@katha/shared";
import type { ArtworkMintingBoundary } from "./artwork-minting.js";
import { artworkMintRequestSchema } from "@katha/shared";
import type { CustodyOperationsBoundary } from "./custody-operations.js";
import {
  custodyPreparationRequestSchema,
  fulfillmentCreateRequestSchema,
  fulfillmentUpdateRequestSchema,
  fulfillmentIdParamsSchema,
} from "@katha/shared";
import type { ConditionAttestationBoundary } from "./condition-attestation.js";
import { conditionAttestationRequestSchema } from "@katha/shared";
import type { ArtworkVerificationBoundary } from "./artwork-verification.js";
import { artworkVerificationRequestSchema } from "@katha/shared";
import type { ArtworkRegistrationBoundary } from "./artwork-registration.js";
import { artworkRegistrationRequestSchema } from "@katha/shared";
import type { PublicDocumentsBoundary } from "./public-documents.js";
import type { DocumentPreparationBoundary } from "./document-preparation.js";
import {
  metadataPreparationRequestSchema,
  conditionPreparationRequestSchema,
} from "@katha/shared";
import type { ArtworkDetailsBoundary } from "./artwork-details.js";
import { artworkDetailParamsSchema, artworkDetailQuerySchema } from "@katha/shared";
import type { ArtworkDiscoveryBoundary } from "./artwork-discovery.js";
import { artworkDiscoveryQuerySchema } from "@katha/shared";
import type { ArtworkDraftsBoundary } from "./artwork-drafts.js";
import {
  artworkDraftCreateRequestSchema,
  artworkDraftParamsSchema,
  artworkDraftUpdateRequestSchema,
} from "@katha/shared";
import type { WalletSessionBoundary } from "./wallet-session.js";
import type { AuthorizationBoundary } from "./authorization.js";
import type { ArtistsBoundary } from "./artists.js";
import {
  artistCreateRequestSchema,
  artistIdParamsSchema,
  artistVerificationRequestSchema,
} from "@katha/shared";
import type { WalletSession } from "@katha/shared";
import { walletChallengeRequestSchema, walletVerifyRequestSchema } from "@katha/shared";
import type { PublicArtistsBoundary } from "./public-artists.js";
import { paginationQuerySchema, artistSlugParamsSchema } from "@katha/shared";
import { parseJson, parseQuery, parseParams } from "./http.js";
import { restrictedCors, requestBodyLimit } from "./http.js";
import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { describeError, DomainError, type ApiErrorCode } from "./errors.js";
import type { Readiness } from "./readiness.js";
import { createLogger, type ApiLogger } from "./logger.js";

export type ApiEnvironment = {
  Variables: {
    requestId: string;
    errorCode: ApiErrorCode;
    walletSession: WalletSession;
  };
};

export function createApi(
  logger: ApiLogger = createLogger(),
  readiness?: Readiness,
  origins: readonly string[] = [],
  sessions?: WalletSessionBoundary,
  authorization?: AuthorizationBoundary,
  artists?: ArtistsBoundary,
  publicArtists?: PublicArtistsBoundary,
  artworkDrafts?: ArtworkDraftsBoundary,
  discovery?: ArtworkDiscoveryBoundary,
  details?: ArtworkDetailsBoundary,
  documents?: DocumentPreparationBoundary,
  publicDocuments?: PublicDocumentsBoundary,
  registration?: ArtworkRegistrationBoundary,
  verification?: ArtworkVerificationBoundary,
  conditionAttestation?: ConditionAttestationBoundary,
  custodyOperations?: CustodyOperationsBoundary,
  minting?: ArtworkMintingBoundary,
  metadataRevisions?: MetadataRevisionsBoundary,
  receipts?: OperationReceiptsBoundary,
  provenance?: ArtworkProvenanceBoundary,
  nfcTags?: NfcTagsBoundary,
  nfcResolution?: NfcResolutionBoundary,
) {
  const app = new Hono<ApiEnvironment>();
  function errorResponse(error: unknown, context: Context<ApiEnvironment>) {
    const { code, message, status } = describeError(error);
    context.set("errorCode", code);
    return context.json(
      { error: { code, message }, requestId: context.get("requestId") },
      status,
    );
  }
  app.use("*", async (context, next) => {
    // Client-supplied IDs are untrusted; each request receives a fresh server ID.
    const requestId = randomUUID();
    context.set("requestId", requestId);
    const start = performance.now();
    try {
      await next();
    } catch (error) {
      // Hono's onError handles Error instances; normalize other thrown values too.
      context.res = errorResponse(error, context);
    }
    context.header("X-Request-Id", requestId);
    const code = context.get("errorCode");
    logger.requestCompleted({
      requestId,
      method: context.req.method,
      status: context.res.status,
      durationMs: performance.now() - start,
      ...(code ? { code } : {}),
    });
  });
  if (sessions) {
    app.use("/auth/*", async (c, next) => {
      c.header("Cache-Control", "no-store");
      await next();
    });
  }
  for (const role of ["admin", "verifier"] as const) {
    app.use(`/${role}/*`, async (c, next) => {
      c.header("Cache-Control", "no-store");
      await next();
    });
  }
  app.use("/nfc/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use("*", restrictedCors(origins));
  app.use("*", requestBodyLimit());
  // Reserve both namespaces before any future write handlers are registered.
  for (const role of ["admin", "verifier"] as const) {
    app.use(`/${role}/*`, async (c, next) => {
      if (!authorization) {
        if (!sessions) throw new DomainError("UNAUTHENTICATED");
        await sessions.authenticate(c.req.header("Authorization"));
        throw new DomainError("FORBIDDEN");
      }
      c.set(
        "walletSession",
        await authorization.requireRole(c.req.header("Authorization"), role),
      );
      await next();
    });
  }
  app.get("/health/live", (context) => {
    context.header("Cache-Control", "no-store");
    return context.json({ status: "alive" });
  });
  app.get("/health/ready", async (context) => {
    context.header("Cache-Control", "no-store");
    const ready = readiness ? await readiness.check() : false;
    return context.json({ status: ready ? "ready" : "unavailable" }, ready ? 200 : 503);
  });
  if (sessions) {
    app.post("/auth/challenge", async (c) =>
      c.json(
        await sessions.challenge(await parseJson(c, walletChallengeRequestSchema)),
        201,
      ),
    );
    app.post("/auth/verify", async (c) =>
      c.json(await sessions.verify(await parseJson(c, walletVerifyRequestSchema))),
    );
    app.get("/auth/session", async (c) =>
      c.json(await sessions.authenticate(c.req.header("Authorization"))),
    );
    app.post("/auth/logout", async (c) => {
      await sessions.logout(c.req.header("Authorization"));
      return c.body(null, 204);
    });
  }
  if (artists) {
    app.post("/admin/artists", async (c) =>
      c.json(await artists.create(await parseJson(c, artistCreateRequestSchema)), 201),
    );
    app.post("/verifier/artists/:artistId/verification", async (c) => {
      const parsed = artistIdParamsSchema.safeParse(c.req.param());
      if (!parsed.success) throw new DomainError("INVALID_REQUEST");
      return c.json(
        await artists.verify(
          parsed.data.artistId,
          await parseJson(c, artistVerificationRequestSchema),
          c.get("walletSession"),
        ),
      );
    });
  }
  if (publicArtists) {
    app.get("/artists", async (c) =>
      c.json(await publicArtists.list(parseQuery(c, paginationQuerySchema))),
    );
    app.get("/artists/:slug", async (c) =>
      c.json(await publicArtists.detail(parseParams(c, artistSlugParamsSchema).slug)),
    );
  }
  if (artworkDrafts) {
    app.patch("/admin/artworks/:kathaId", async (c) => {
      const { kathaId } = parseParams(c, artworkDraftParamsSchema);
      return c.json(
        await artworkDrafts.update(
          kathaId,
          await parseJson(c, artworkDraftUpdateRequestSchema),
        ),
      );
    });
    app.post("/admin/artworks", async (c) =>
      c.json(
        await artworkDrafts.create(await parseJson(c, artworkDraftCreateRequestSchema)),
        201,
      ),
    );
  }
  if (nfcResolution) {
    app.get("/nfc/:tagId", async (c) => {
      const { tagId } = parseParams(c, nfcTagParamsSchema);
      parseQuery(c, nfcResolutionQuerySchema);
      return c.redirect(await nfcResolution.resolve(tagId), 302);
    });
  }
  if (nfcTags) {
    app.post("/admin/artworks/:kathaId/nfc-tags", async (c) =>
      c.json(
        await nfcTags.assign(
          parseParams(c, nfcArtworkParamsSchema).kathaId,
          await parseJson(c, nfcTagAssignmentRequestSchema),
          c.get("walletSession"),
        ),
        200,
      ),
    );
    app.get("/admin/nfc-tags/:tagId", async (c) =>
      c.json(await nfcTags.get(parseParams(c, nfcTagParamsSchema).tagId)),
    );
    app.post("/admin/nfc-tags/:tagId/retire", async (c) => {
      const { tagId } = parseParams(c, nfcTagParamsSchema);
      await parseJson(c, nfcTagRetirementRequestSchema);
      return c.json(await nfcTags.retire(tagId, c.get("walletSession")));
    });
  }
  if (discovery) {
    app.get("/artworks", async (c) =>
      c.json(await discovery.list(parseQuery(c, artworkDiscoveryQuerySchema))),
    );
  }
  if (provenance) {
    app.get("/artworks/:kathaId/provenance", async (c) => {
      const { kathaId } = parseParams(c, artworkProvenanceParamsSchema);
      return c.json(
        await provenance.history(kathaId, parseQuery(c, artworkProvenanceQuerySchema)),
      );
    });
  }
  if (details) {
    app.get("/artworks/:kathaId", async (c) => {
      parseQuery(c, artworkDetailQuerySchema);
      const { kathaId } = parseParams(c, artworkDetailParamsSchema);
      return c.json(await details.detail(kathaId));
    });
  }
  if (documents) {
    app.post("/verifier/artworks/:kathaId/documents/metadata", async (c) => {
      const { kathaId } = parseParams(c, artworkDraftParamsSchema);
      return c.json(
        await documents.metadata(
          kathaId,
          await parseJson(c, metadataPreparationRequestSchema),
          c.get("walletSession"),
        ),
        201,
      );
    });
    app.post("/verifier/artworks/:kathaId/documents/condition", async (c) => {
      const { kathaId } = parseParams(c, artworkDraftParamsSchema);
      return c.json(
        await documents.condition(
          kathaId,
          await parseJson(c, conditionPreparationRequestSchema),
          c.get("walletSession"),
        ),
        201,
      );
    });
  }
  if (publicDocuments) {
    app.get("/storage/public/:filename", async (c) => {
      parseQuery(c, artworkDetailQuerySchema);
      const result = await publicDocuments.read(c.req.param("filename"));
      c.header("Content-Type", result.mimeType);
      c.header("X-Content-Type-Options", "nosniff");
      c.header("Cache-Control", "no-store");
      return c.body(new Uint8Array(result.bytes));
    });
  }
  if (registration) {
    app.post("/admin/artworks/:kathaId/operations/registration", async (c) => {
      const { kathaId } = parseParams(c, artworkDraftParamsSchema);
      parseQuery(c, artworkDetailQuerySchema);
      return c.json(
        await registration.prepare(
          c.req.header("Authorization"),
          kathaId,
          await parseJson(c, artworkRegistrationRequestSchema),
        ),
        201,
      );
    });
  }
  if (verification) {
    app.post("/verifier/artworks/:kathaId/operations/verification", async (c) => {
      const { kathaId } = parseParams(c, artworkDraftParamsSchema);
      parseQuery(c, artworkDetailQuerySchema);
      return c.json(
        await verification.prepare(
          c.req.header("Authorization"),
          kathaId,
          await parseJson(c, artworkVerificationRequestSchema),
        ),
        201,
      );
    });
  }
  if (conditionAttestation) {
    app.post("/verifier/artworks/:kathaId/operations/condition", async (c) => {
      const { kathaId } = parseParams(c, artworkDraftParamsSchema);
      parseQuery(c, artworkDetailQuerySchema);
      return c.json(
        await conditionAttestation.prepare(
          c.req.header("Authorization"),
          kathaId,
          await parseJson(c, conditionAttestationRequestSchema),
        ),
        201,
      );
    });
  }
  if (custodyOperations) {
    app.use("/fulfillment/*", async (c, next) => {
      c.header("Cache-Control", "no-store");
      await next();
    });
    app.post("/admin/artworks/:kathaId/operations/custody", async (c) => {
      const { kathaId } = parseParams(c, artworkDraftParamsSchema);
      parseQuery(c, artworkDetailQuerySchema);
      return c.json(
        await custodyOperations.prepare(
          c.req.header("Authorization"),
          kathaId,
          await parseJson(c, custodyPreparationRequestSchema),
        ),
        201,
      );
    });
    app.post("/fulfillment/artworks/:kathaId", async (c) => {
      const { kathaId } = parseParams(c, artworkDraftParamsSchema);
      parseQuery(c, artworkDetailQuerySchema);
      return c.json(
        await custodyOperations.create(
          c.req.header("Authorization"),
          kathaId,
          await parseJson(c, fulfillmentCreateRequestSchema),
        ),
        201,
      );
    });
    app.get("/fulfillment/:requestId", async (c) => {
      const { requestId } = parseParams(c, fulfillmentIdParamsSchema);
      parseQuery(c, artworkDetailQuerySchema);
      return c.json(
        await custodyOperations.detail(c.req.header("Authorization"), requestId),
        200,
      );
    });
    app.patch("/admin/fulfillment/:requestId", async (c) => {
      const { requestId } = parseParams(c, fulfillmentIdParamsSchema);
      parseQuery(c, artworkDetailQuerySchema);
      return c.json(
        await custodyOperations.update(
          c.req.header("Authorization"),
          requestId,
          await parseJson(c, fulfillmentUpdateRequestSchema),
        ),
        200,
      );
    });
  }
  if (minting) {
    app.post("/admin/artworks/:kathaId/operations/mint", async (c) => {
      const { kathaId } = parseParams(c, artworkDraftParamsSchema);
      parseQuery(c, artworkDetailQuerySchema);
      return c.json(
        await minting.prepare(
          c.req.header("Authorization"),
          kathaId,
          await parseJson(c, artworkMintRequestSchema),
        ),
        201,
      );
    });
  }
  if (metadataRevisions) {
    app.post("/admin/artworks/:kathaId/operations/metadata", async (c) => {
      const { kathaId } = parseParams(c, artworkDraftParamsSchema);
      parseQuery(c, artworkDetailQuerySchema);
      return c.json(
        await metadataRevisions.prepare(
          c.req.header("Authorization"),
          kathaId,
          await parseJson(c, metadataRevisionRequestSchema),
        ),
        201,
      );
    });
  }
  if (receipts) {
    app.use("/operations/*", async (c, next) => {
      c.header("Cache-Control", "no-store");
      await next();
    });
    app.post("/operations/:operationId/receipts", async (c) => {
      const { operationId } = parseParams(c, operationReceiptParamsSchema);
      parseQuery(c, artworkDetailQuerySchema);
      return c.json(
        await receipts.reconcile(
          c.req.header("Authorization"),
          operationId,
          await parseJson(c, operationReceiptRequestSchema),
        ),
        200,
      );
    });
  }
  app.onError(errorResponse);
  app.notFound((context) => errorResponse(new DomainError("NOT_FOUND"), context));
  return app;
}
