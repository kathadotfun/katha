import { mintingFixture } from "../apps/web/tests/fixtures/minting.ts";
import { custodyFixture } from "../apps/web/tests/fixtures/custody.ts";
import { conditionFixture } from "../apps/web/tests/fixtures/condition.ts";
import { canonicalDocumentBytes, sha256Hex } from "../packages/shared/dist/index.js";
import { verificationFixture } from "../apps/web/tests/fixtures/verification.ts";
import { registrationFixture } from "../apps/web/tests/fixtures/registration.ts";
/* global Request */
import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";
import { walletSignInMessage } from "../packages/shared/dist/index.js";
import { renderTransactionReviewPhase } from "../apps/web/tests/fixtures/transaction-review.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

// Called by the existing synthetic HTTP harness; never attach to user services.
export async function runPublicBrowsingJourneys({
  origin,
  apiOrigin,
  setHomeMode,
  setLongContent,
  setArtworkOutage,
}) {
  const browser = await chromium.launch();
  const artifacts = fileURLToPath(
    new URL("../helper/build/reports/086/", import.meta.url),
  );
  await mkdir(artifacts, { recursive: true });
  let scans = 0;
  try {
    for (const width of [320, 768, 1440]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      // The suite must stay local, including browser images and Next prefetches.
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        return [origin, apiOrigin].includes(url.origin)
          ? route.continue()
          : route.abort();
      });
      async function audit(label) {
        await expect(page.getByRole("main")).toHaveCount(1);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        assert.equal(await page.locator("html").getAttribute("lang"), "en");
        await expect(page).toHaveTitle(/\S/);
        assert.ok(
          await page.evaluate(
            () =>
              globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
          ),
          `${label} overflows at ${width}px`,
        );
        const results = await new AxeBuilder({ page }).analyze();
        assert.deepEqual(
          results.violations.map(({ id, nodes }) => ({
            id,
            targets: nodes.map((node) => node.target),
          })),
          [],
          `${label} accessibility at ${width}px`,
        );
        scans++;
      }
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(origin);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Real World Assets, rooted in Nepali culture.",
      );
      await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
      const walletPanel = page.locator("#wallet-connection-panel");
      await expect(walletPanel).toContainText("No compatible Solana wallet found");
      await audit("wallet unavailable");
      // Register a synthetic Wallet Standard wallet after discovery is running.
      // No extension, private key, signing or external network is involved.
      let logoutCalls = 0;
      let verifyCalls = 0;
      let rejectVerification = true;
      let adminAllowed = true;
      let verifierAllowed = true;
      let createCalls = 0;
      let approvalCalls = 0;
      let savedArtist = null;
      let draftMode = "READY";
      let rejectCreation = true;
      const adminHeaders = {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "content-type,authorization",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
        "Cache-Control": "no-store",
      };
      const authSession = () => ({
        walletId: "bbbbbbbb-1111-4111-8111-111111111111",
        walletAddress: "11111111111111111111111111111112",
        cluster: "localnet",
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      });
      await context.route(`${apiOrigin}/admin/artworks?**`, async (route) => {
        if (route.request().method() === "OPTIONS")
          return route.fulfill({ status: 204, headers: adminHeaders });
        assert.equal(
          route.request().headers().authorization,
          `Bearer ${"a".repeat(64)}`,
        );
        if (draftMode === "UNAVAILABLE" || draftMode === "DENIED")
          return route.fulfill({
            status: draftMode === "DENIED" ? 403 : 503,
            headers: adminHeaders,
            json: { error: "PRIVATE_DRAFT_SENTINEL" },
          });
        const query = new URL(route.request().url()).searchParams;
        const offset = Number(query.get("offset"));
        assert.equal(query.get("limit"), "20");
        const items = Array.from(
          { length: draftMode === "EMPTY" ? 0 : offset ? 1 : 20 },
          (_, i) => ({
            id: `dddddddd-1111-4111-8111-${String(offset + i + 1).padStart(12, "0")}`,
            kathaId: `KATHA-PAUBHA-${String(offset + i + 1).padStart(6, "0")}`,
            category: "PAUBHA",
            title: offset
              ? "Synthetic second-page draft"
              : `Synthetic unpublished work ${i + 1}`,
            creationYear: 2026,
            artist: {
              id: "cccccccc-1111-4111-8111-111111111111",
              displayName: "Synthetic Nepali artist",
              verificationStatus: i % 2 ? "VERIFIED" : "UNVERIFIED",
            },
            workflowStatus: i % 2 ? "LIFECYCLE_STARTED" : "DOCUMENTING",
            createdAt: "2026-10-06T00:00:00Z",
            updatedAt: "2026-10-06T00:00:00Z",
          }),
        );
        return route.fulfill({
          headers: adminHeaders,
          json: {
            items,
            pagination: {
              limit: 20,
              offset,
              hasMore: draftMode === "READY" && offset === 0,
            },
          },
        });
      });
      let savedArtwork = null;
      let rejectDraftSave = true;
      let freezeDraft = false;
      let draftCreateCalls = 0;
      let retainedCreationId = null;
      await context.route(`${apiOrigin}/admin/artworks`, async (route) => {
        if (route.request().method() === "OPTIONS")
          return route.fulfill({ status: 204, headers: adminHeaders });
        assert.equal(route.request().method(), "POST");
        assert.equal(
          route.request().headers().authorization,
          `Bearer ${"a".repeat(64)}`,
        );
        const data = route.request().postDataJSON();
        retainedCreationId = data.creationRequestId;
        draftCreateCalls++;
        savedArtwork = {
          ...data,
          id: "cccccccc-1111-4111-8111-111111111111",
          kathaId: "KATHA-PAUBHA-000050",
          creatorWallet: null,
          createdAt: "2026-10-06T00:00:00.000Z",
          updatedAt: "2026-10-06T00:00:00.000Z",
        };
        delete savedArtwork.creationRequestId;
        return route.fulfill({
          status: 201,
          headers: adminHeaders,
          json: savedArtwork,
        });
      });
      await context.route(`${apiOrigin}/admin/artworks/*`, async (route) => {
        if (route.request().method() === "OPTIONS")
          return route.fulfill({ status: 204, headers: adminHeaders });
        assert.equal(
          route.request().headers().authorization,
          `Bearer ${"a".repeat(64)}`,
        );
        if (route.request().method() === "PATCH") {
          const data = route.request().postDataJSON();
          assert.equal(data.expectedUpdatedAt, savedArtwork.updatedAt);
          for (const key of [
            "artistId",
            "category",
            "creationYear",
            "kathaId",
            "creatorWallet",
          ])
            assert.ok(!(key in data));
          if (rejectDraftSave)
            return route.fulfill({
              status: 409,
              headers: adminHeaders,
              json: { error: "PRIVATE_SAVE_SENTINEL" },
            });
          delete data.expectedUpdatedAt;
          savedArtwork = {
            ...savedArtwork,
            ...data,
            updatedAt: "2026-10-06T00:00:00.001Z",
          };
          return route.fulfill({ headers: adminHeaders, json: savedArtwork });
        }
        return route.fulfill({
          headers: adminHeaders,
          json: { artwork: savedArtwork, editable: !freezeDraft },
        });
      });
      const registration = await registrationFixture();
      let registrationPage = { ...registration.page, metadata: null };
      let metadataCalls = 0,
        registrationCalls = 0,
        registrationSimulations = 0;
      let rejectRegistration = true;
      await context.route(
        `${apiOrigin}/admin/artworks/*/registration`,
        async (route) => {
          if (route.request().method() === "OPTIONS")
            return route.fulfill({ status: 204, headers: adminHeaders });
          assert.equal(
            route.request().headers().authorization,
            `Bearer ${"a".repeat(64)}`,
          );
          registrationPage.updatedAt = savedArtwork.updatedAt;
          return route.fulfill({ headers: adminHeaders, json: registrationPage });
        },
      );
      await context.route(
        `${apiOrigin}/admin/artworks/*/documents/metadata`,
        async (route) => {
          if (route.request().method() === "OPTIONS")
            return route.fulfill({ status: 204, headers: adminHeaders });
          const input = route.request().postDataJSON();
          assert.equal(input.expectedUpdatedAt, registrationPage.updatedAt);
          metadataCalls++;
          registrationPage.metadata = registration.page.metadata;
          const { id, version, documentHash, uri } = registration.page.metadata;
          return route.fulfill({
            status: 201,
            headers: adminHeaders,
            json: {
              id,
              version,
              documentHash,
              uri,
              kathaId: registration.page.kathaId,
              status: "PREPARED",
            },
          });
        },
      );
      await context.route(
        `${apiOrigin}/admin/artworks/*/operations/registration`,
        async (route) => {
          if (route.request().method() === "OPTIONS")
            return route.fulfill({ status: 204, headers: adminHeaders });
          const input = route.request().postDataJSON();
          registrationCalls++;
          assert.equal(input.metadataVersionId, registration.page.metadata.id);
          assert.deepEqual(input.supportedTransactionVersions, [0, 1]);
          assert.equal(
            input.idempotencyKey,
            `register-${authSession().walletId}-${registration.page.metadata.id}`,
          );
          if (rejectRegistration)
            return route.fulfill({
              status: 409,
              headers: adminHeaders,
              json: { error: "PRIVATE_REGISTRATION_ERROR" },
            });
          return route.fulfill({
            status: 201,
            headers: adminHeaders,
            json: registration.operation,
          });
        },
      );
      const mintFixtureData = await mintingFixture(),
        mintPage = mintFixtureData.page;
      let mintPreparations = 0,
        publications = 0,
        rejectPublication = true;
      for (const action of ["minting", "operations/mint", "publication"]) {
        await context.route(
          `${apiOrigin}/admin/artworks/*/${action}`,
          async (route) => {
            if (route.request().method() === "OPTIONS")
              return route.fulfill({ status: 204, headers: adminHeaders });
            assert.equal(
              route.request().headers().authorization,
              `Bearer ${"a".repeat(64)}`,
            );
            if (!adminAllowed)
              return route.fulfill({
                status: 403,
                headers: adminHeaders,
                json: { error: "denied" },
              });
            if (action === "operations/mint") {
              mintPreparations++;
              const input = route.request().postDataJSON();
              assert.equal(input.initialConditionReportId, mintPage.initialReport.id);
              assert.equal(input.metadataVersionId, mintPage.metadata.id);
              assert.equal(input.expectedCustodyRevision, "1");
              return route.fulfill({
                headers: adminHeaders,
                json: mintFixtureData.operation,
              });
            }
            if (action === "publication") {
              publications++;
              const input = route.request().postDataJSON();
              assert.equal(input.publicationConfirmed, true);
              assert.equal(input.expectedUpdatedAt, mintPage.updatedAt);
              if (rejectPublication)
                return route.fulfill({
                  status: 409,
                  headers: adminHeaders,
                  json: { error: "PRIVATE_PUBLICATION_ERROR" },
                });
              mintPage.published = true;
              mintPage.canPublish = false;
              mintPage.updatedAt = "2026-10-07T00:00:00.000Z";
            }
            return route.fulfill({ headers: adminHeaders, json: mintPage });
          },
        );
      }
      const custodyFixtureData = await custodyFixture("DISPATCH_FROM_KATHA");
      const custodyPage = custodyFixtureData.page;
      custodyPage.chain.ownerWallet = "11111111111111111111111111111113";
      let fulfillmentWrites = 0,
        custodyPreparations = 0,
        rejectFulfillment = true;
      await context.route(`${apiOrigin}/admin/artworks/*/custody**`, async (route) => {
        if (route.request().method() === "OPTIONS")
          return route.fulfill({ status: 204, headers: adminHeaders });
        assert.equal(
          route.request().headers().authorization,
          `Bearer ${"a".repeat(64)}`,
        );
        if (!adminAllowed)
          return route.fulfill({
            status: 403,
            headers: adminHeaders,
            json: { error: "forbidden" },
          });
        return route.fulfill({ headers: adminHeaders, json: custodyPage });
      });
      await context.route(`${apiOrigin}/admin/fulfillment/*`, async (route) => {
        if (route.request().method() === "OPTIONS")
          return route.fulfill({ status: 204, headers: adminHeaders });
        assert.equal(
          route.request().headers().authorization,
          `Bearer ${"a".repeat(64)}`,
        );
        fulfillmentWrites++;
        if (rejectFulfillment)
          return route.fulfill({
            status: 409,
            headers: adminHeaders,
            json: { error: "conflict" },
          });
        const input = route.request().postDataJSON(),
          row = custodyPage.requests[0];
        assert.equal(input.manualConfirmation, true);
        assert.equal(input.expectedUpdatedAt, row.request.updatedAt);
        assert.equal(input.status, "APPROVED");
        Object.assign(row.request, {
          status: "APPROVED",
          updatedAt: "2026-10-06T00:00:02.000Z",
          courier: input.courier,
          trackingReference: input.trackingReference,
        });
        row.allowedStatuses = ["DISPATCHED", "CANCELLED"];
        row.transitions = [custodyFixtureData.transition];
        return route.fulfill({ headers: adminHeaders, json: row.request });
      });
      await context.route(
        `${apiOrigin}/admin/artworks/*/operations/custody`,
        async (route) => {
          if (route.request().method() === "OPTIONS")
            return route.fulfill({ status: 204, headers: adminHeaders });
          custodyPreparations++;
          const input = route.request().postDataJSON();
          assert.equal(input.expectedCustodyRevision, "1");
          assert.equal(input.movementConfirmed, true);
          assert.equal(input.fulfillmentId, custodyPage.requests[0].request.id);
          assert.equal(JSON.stringify(input).includes("Synthetic recipient"), false);
          assert.equal(
            JSON.stringify(input).includes("synthetic@example.invalid"),
            false,
          );
          return route.fulfill({
            status: 201,
            headers: adminHeaders,
            json: custodyFixtureData.operation,
          });
        },
      );
      let inspection = await conditionFixture();
      let inspectionPage = inspection.page,
        inspectionCalls = 0,
        rejectInspection = true;
      await context.route(
        `${apiOrigin}/verifier/artworks/*/condition`,
        async (route) => {
          if (route.request().method() === "OPTIONS")
            return route.fulfill({ status: 204, headers: adminHeaders });
          assert.equal(
            route.request().headers().authorization,
            `Bearer ${"a".repeat(64)}`,
          );
          if (!verifierAllowed)
            return route.fulfill({
              status: 403,
              headers: adminHeaders,
              json: { error: "forbidden" },
            });
          return route.fulfill({ headers: adminHeaders, json: inspectionPage });
        },
      );
      await context.route(
        `${apiOrigin}/verifier/artworks/*/condition/evidence`,
        async (route) => {
          if (route.request().method() === "OPTIONS")
            return route.fulfill({ status: 204, headers: adminHeaders });
          const form = await new Request(route.request().url(), {
            method: "POST",
            headers: route.request().headers(),
            body: route.request().postDataBuffer(),
          }).formData();
          const metadata = JSON.parse(form.get("metadata")),
            file = form.get("file");
          assert.equal(metadata.visibility, "PRIVATE");
          assert.equal(metadata.role, "CONDITION");
          assert.equal(metadata.approvedPublic, false);
          assert.equal(metadata.expectedUpdatedAt, inspectionPage.updatedAt);
          const hash = await sha256Hex(new Uint8Array(await file.arrayBuffer()));
          inspectionPage = {
            ...inspectionPage,
            updatedAt: "2026-10-06T00:00:01.000Z",
            media: [
              ...inspectionPage.media,
              {
                id: "eeeeeeee-1111-4111-8111-111111111111",
                contentHash: hash,
                mimeType: "image/png",
                byteSize: String(file.size),
              },
            ],
          };
          return route.fulfill({
            status: 201,
            headers: adminHeaders,
            json: inspectionPage,
          });
        },
      );
      await context.route(
        `${apiOrigin}/verifier/artworks/*/documents/condition`,
        async (route) => {
          if (route.request().method() === "OPTIONS")
            return route.fulfill({ status: 204, headers: adminHeaders });
          const data = route.request().postDataJSON(),
            { expectedUpdatedAt, mediaIds, ...fields } = data;
          assert.equal(expectedUpdatedAt, inspectionPage.updatedAt);
          assert.equal(data.reason, "INITIAL_VERIFICATION");
          const document = {
            ...fields,
            kathaId: inspectionPage.kathaId,
            verifierWallet: inspection.operation.feePayer,
            mediaHashes: mediaIds.map(
              (id) => inspectionPage.media.find((item) => item.id === id).contentHash,
            ),
          };
          inspection = await conditionFixture("initial", undefined, { document });
          inspectionPage = {
            ...inspectionPage,
            report: { ...inspection.page.report, version: 2 },
          };
          assert.equal(
            inspectionPage.report.canonicalDocument,
            new TextDecoder().decode(canonicalDocumentBytes(document)),
          );
          return route.fulfill({
            status: 201,
            headers: adminHeaders,
            json: {
              id: document.reportId,
              kathaId: document.kathaId,
              version: 2,
              status: "PREPARED",
              documentHash: inspectionPage.report.documentHash,
              uri: null,
            },
          });
        },
      );
      await context.route(
        `${apiOrigin}/verifier/artworks/*/operations/condition`,
        async (route) => {
          if (route.request().method() === "OPTIONS")
            return route.fulfill({ status: 204, headers: adminHeaders });
          const input = route.request().postDataJSON();
          inspectionCalls++;
          assert.equal(input.reportId, inspectionPage.report.id);
          assert.equal(input.expectedConditionVersion, 0);
          assert.equal(input.expectedUpdatedAt, inspectionPage.updatedAt);
          return rejectInspection
            ? route.fulfill({
                status: 409,
                headers: adminHeaders,
                json: { error: "PRIVATE_INSPECTION_ERROR" },
              })
            : route.fulfill({
                status: 201,
                headers: adminHeaders,
                json: inspection.operation,
              });
        },
      );
      const verification = await verificationFixture();
      let verificationPage = verification.page;
      let verificationCalls = 0,
        rejectArtworkVerification = true;
      await context.route(
        `${apiOrigin}/verifier/artworks/*/verification`,
        async (route) => {
          if (route.request().method() === "OPTIONS")
            return route.fulfill({ status: 204, headers: adminHeaders });
          assert.equal(
            route.request().headers().authorization,
            `Bearer ${"a".repeat(64)}`,
          );
          if (!verifierAllowed)
            return route.fulfill({
              status: 403,
              headers: adminHeaders,
              json: { error: "forbidden" },
            });
          return route.fulfill({ headers: adminHeaders, json: verificationPage });
        },
      );
      await context.route(
        `${apiOrigin}/verifier/artworks/*/operations/verification`,
        async (route) => {
          if (route.request().method() === "OPTIONS")
            return route.fulfill({ status: 204, headers: adminHeaders });
          const input = route.request().postDataJSON();
          assert.deepEqual(
            Object.keys(input).sort(),
            [
              "authenticityConfirmed",
              "expectedUpdatedAt",
              "idempotencyKey",
              "metadataVersionId",
              "reviewedEvidenceHash",
              "supportedTransactionVersions",
            ].sort(),
          );
          assert.equal(input.authenticityConfirmed, true);
          assert.equal(
            input.reviewedEvidenceHash,
            verificationPage.identity.authorshipEvidenceHash,
          );
          assert.equal(input.expectedUpdatedAt, verificationPage.updatedAt);
          verificationCalls++;
          return rejectArtworkVerification
            ? route.fulfill({
                status: 409,
                headers: adminHeaders,
                json: { error: "PRIVATE_VERIFICATION_ERROR" },
              })
            : route.fulfill({
                status: 201,
                headers: adminHeaders,
                json: verification.operation,
              });
        },
      );
      await context.route("http://127.0.0.1:8899/**", async (route) => {
        const headers = {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Headers": "content-type,solana-client",
          "Access-Control-Allow-Methods": "POST,OPTIONS",
        };
        if (route.request().method() === "OPTIONS")
          return route.fulfill({ status: 204, headers });
        const input = route.request().postDataJSON();
        let result;
        if (input.method === "getGenesisHash")
          result = "11111111111111111111111111111111";
        else if (input.method === "getBlockHeight") result = 20;
        else if (input.method === "getFeeForMessage")
          result = { context: { slot: 10 }, value: 5000 };
        else if (input.method === "simulateTransaction") {
          registrationSimulations++;
          result = {
            context: { slot: 10 },
            value: { err: null, logs: [], unitsConsumed: 200 },
          };
        } else throw new Error("No signing or broadcast in this browser fixture");
        return route.fulfill({
          headers,
          json: { jsonrpc: "2.0", id: input.id, result },
        });
      });
      let mediaPage = null;
      let mediaWrites = 0;
      let rejectMediaSave = true;
      await context.route(`${apiOrigin}/admin/artworks/*/media`, async (route) => {
        const request = route.request();
        if (request.method() === "OPTIONS")
          return route.fulfill({ status: 204, headers: adminHeaders });
        assert.equal(request.headers().authorization, `Bearer ${"a".repeat(64)}`);
        mediaPage ??= {
          kathaId: savedArtwork.kathaId,
          updatedAt: savedArtwork.updatedAt,
          editable: true,
          items: [],
        };
        if (request.method() === "POST") {
          const form = await new Request("http://localhost/upload", {
            method: "POST",
            headers: { "Content-Type": request.headers()["content-type"] },
            body: request.postDataBuffer(),
          }).formData();
          const data = JSON.parse(String(form.get("metadata")));
          assert.equal(data.expectedUpdatedAt, mediaPage.updatedAt);
          assert.equal(data.visibility, "PRIVATE");
          assert.equal(data.approvedPublic, false);
          const id = `dddddddd-1111-4111-8111-${String(mediaPage.items.length + 1).padStart(12, "0")}`;
          mediaPage.items.push({
            id,
            role: data.role,
            visibility: data.visibility,
            altText: data.altText,
            caption: data.caption,
            kind: "IMAGE",
            mimeType: data.mimeType,
            byteSize: String(form.get("file").size),
            contentHash: String(mediaPage.items.length + 1).repeat(64),
            position: mediaPage.items.length,
          });
          mediaPage.updatedAt = new Date(
            Date.parse(mediaPage.updatedAt) + 1,
          ).toISOString();
          mediaWrites++;
          return route.fulfill({ status: 201, headers: adminHeaders, json: mediaPage });
        }
        if (request.method() === "PATCH") {
          const data = request.postDataJSON();
          assert.equal(data.expectedUpdatedAt, mediaPage.updatedAt);
          if (rejectMediaSave)
            return route.fulfill({
              status: 409,
              headers: adminHeaders,
              json: { error: "PRIVATE_MEDIA_SENTINEL" },
            });
          mediaPage.items = data.items.map((item, position) => {
            const existing = mediaPage.items.find((value) => value.id === item.id);
            const { approvedPublic, ...fields } = item;
            if (item.visibility === "PUBLIC") assert.equal(approvedPublic, true);
            return { ...existing, ...fields, position };
          });
          mediaPage.updatedAt = new Date(
            Date.parse(mediaPage.updatedAt) + 1,
          ).toISOString();
          mediaWrites++;
        }
        return route.fulfill({ headers: adminHeaders, json: mediaPage });
      });
      await context.route(`${apiOrigin}/admin/artists`, async (route) => {
        if (route.request().method() === "OPTIONS")
          return route.fulfill({ status: 204, headers: adminHeaders });
        assert.equal(
          route.request().headers().authorization,
          `Bearer ${"a".repeat(64)}`,
        );
        createCalls++;
        if (rejectCreation) {
          rejectCreation = false;
          return route.fulfill({
            status: 409,
            headers: adminHeaders,
            json: { message: "PRIVATE_ADMIN_SENTINEL" },
          });
        }
        savedArtist = {
          ...route.request().postDataJSON(),
          id: "cccccccc-1111-4111-8111-111111111111",
          verificationStatus: "UNVERIFIED",
          verifiedByWallet: null,
          verifiedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        return route.fulfill({ status: 201, headers: adminHeaders, json: savedArtist });
      });
      await context.route(`${apiOrigin}/verifier/artists/**`, async (route) => {
        const request = route.request();
        if (request.method() === "OPTIONS")
          return route.fulfill({ status: 204, headers: adminHeaders });
        assert.equal(request.headers().authorization, `Bearer ${"a".repeat(64)}`);
        if (request.method() === "POST") {
          approvalCalls++;
          assert.deepEqual(request.postDataJSON(), { confirmed: true });
          savedArtist = {
            ...savedArtist,
            verificationStatus: "VERIFIED",
            verifiedByWallet: walletAddress,
            verifiedAt: new Date().toISOString(),
          };
        }
        return route.fulfill({ headers: adminHeaders, json: savedArtist });
      });
      const walletAddress = "11111111111111111111111111111112";
      await context.route(`${apiOrigin}/auth/**`, async (route) => {
        const request = route.request();
        const headers = {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Headers": "content-type,authorization",
          "Access-Control-Allow-Methods": "POST,OPTIONS",
          "Cache-Control": "no-store",
        };
        if (request.method() === "OPTIONS")
          return route.fulfill({ status: 204, headers });
        if (request.url().endsWith("/logout")) {
          logoutCalls++;
          return route.fulfill({ status: 204, headers });
        }
        if (request.url().endsWith("/permissions"))
          return route.fulfill({
            headers: adminHeaders,
            json: {
              session: authSession(),
              admin: adminAllowed,
              verifier: verifierAllowed,
            },
          });
        const input = request.postDataJSON();
        if (request.url().endsWith("/challenge")) {
          assert.equal(input.walletAddress, walletAddress);
          assert.equal(input.cluster, "localnet");
          const challengeId = "aaaaaaaa-1111-4111-8111-111111111111";
          const expiresAt = new Date(Date.now() + 60_000).toISOString();
          return route.fulfill({
            headers,
            json: {
              challengeId,
              expiresAt,
              message: walletSignInMessage({
                origin,
                walletAddress,
                cluster: "localnet",
                nonce: "a".repeat(64),
                issuedAt: new Date().toISOString(),
                expiresAt,
                challengeId,
              }),
            },
          });
        }
        verifyCalls++;
        assert.equal(input.walletAddress, walletAddress);
        assert.equal(
          input.signature,
          globalThis.btoa(String.fromCharCode(...new Uint8Array(64))),
        );
        if (rejectVerification) {
          rejectVerification = false;
          return route.fulfill({
            status: 401,
            headers,
            json: { message: "PRIVATE_AUTH_ERROR" },
          });
        }
        return route.fulfill({
          headers,
          json: {
            token: "a".repeat(64),
            session: {
              walletId: "bbbbbbbb-1111-4111-8111-111111111111",
              walletAddress,
              cluster: "localnet",
              expiresAt: new Date(Date.now() + 120_000).toISOString(),
            },
          },
        });
      });
      await page.evaluate(() => {
        const listeners = new Set();
        const accounts = [
          {
            address: "11111111111111111111111111111111",
            publicKey: new Uint8Array(32),
            chains: ["solana:localnet"],
            features: ["solana:signMessage", "solana:signTransaction"],
          },
          {
            address: "11111111111111111111111111111112",
            publicKey: Uint8Array.from([...new Array(31).fill(0), 1]),
            chains: ["solana:localnet"],
            features: ["solana:signMessage", "solana:signTransaction"],
          },
        ];
        let connected = false;
        let reject = true;
        let signCalls = 0;
        let transactionCalls = 0;
        let unregister;
        const wallet = {
          version: "1.0.0",
          name: "Synthetic test wallet",
          icon: "data:image/png;base64,",
          chains: ["solana:localnet"],
          get accounts() {
            return connected ? accounts : [];
          },
          features: {
            "standard:connect": {
              version: "1.0.0",
              async connect() {
                if (reject) {
                  reject = false;
                  throw new Error("PRIVATE_WALLET_ERROR");
                }
                connected = true;
                for (const listener of listeners) listener({ accounts });
                return { accounts };
              },
            },
            "standard:disconnect": {
              version: "1.0.0",
              async disconnect() {
                connected = false;
                for (const listener of listeners) listener({ accounts: [] });
              },
            },
            "standard:events": {
              version: "1.0.0",
              on(event, listener) {
                if (event === "change") listeners.add(listener);
                return () => listeners.delete(listener);
              },
            },
            "solana:signMessage": {
              version: "1.0.0",
              async signMessage(input) {
                signCalls++;
                if (
                  !(input.message instanceof Uint8Array) ||
                  !new globalThis.TextDecoder()
                    .decode(input.message)
                    .startsWith("Katha wallet sign-in\n")
                )
                  throw new Error("Unexpected message");
                return [
                  { signedMessage: input.message, signature: new Uint8Array(64) },
                ];
              },
            },
            "solana:signTransaction": {
              version: "1.0.0",
              supportedTransactionVersions: [0, 1],
              async signTransaction() {
                transactionCalls++;
                throw new Error("No transactions in session tests");
              },
            },
          },
        };
        globalThis.window.dispatchEvent(
          new globalThis.CustomEvent("wallet-standard:register-wallet", {
            detail: (api) => {
              unregister = api.register(wallet);
            },
          }),
        );
        globalThis.__kathaWalletTest = {
          unregister: () => unregister(),
          signCalls: () => signCalls,
          transactionCalls: () => transactionCalls,
        };
      });
      await walletPanel
        .getByRole("button", { name: "Connect Synthetic test wallet" })
        .click();
      await expect(walletPanel.getByRole("alert")).toContainText(
        "request was not completed",
      );
      await expect(walletPanel).not.toContainText("PRIVATE_WALLET_ERROR");
      await walletPanel
        .getByRole("button", { name: "Connect Synthetic test wallet" })
        .click();
      await expect(walletPanel).toContainText("11111111111111111111111111111111");
      await walletPanel
        .getByLabel("Wallet account")
        .selectOption("11111111111111111111111111111112");
      await expect(walletPanel.getByLabel("Wallet account")).toHaveValue(
        "11111111111111111111111111111112",
      );
      await expect(walletPanel).toContainText("Network: Localnet");
      await walletPanel
        .getByRole("button", { name: "Sign in to Katha", exact: true })
        .click();
      await expect(walletPanel.getByRole("alert")).toContainText(
        "Sign-in was not completed",
      );
      await expect(walletPanel).not.toContainText("PRIVATE_AUTH_ERROR");
      await walletPanel
        .getByRole("button", { name: "Sign in to Katha", exact: true })
        .click();
      await expect(walletPanel.getByRole("status")).toHaveText("Signed in to Katha");
      await audit("wallet signed in");
      await walletPanel
        .getByRole("link", { name: "Administration", exact: true })
        .click();
      const adminMain = page.getByRole("main");
      await expect(
        adminMain.getByRole("heading", { name: "Create an artist profile" }),
      ).toBeVisible();
      await audit("authorized artist onboarding");
      await adminMain
        .getByRole("button", { name: "Create artist profile", exact: true })
        .click();
      await expect(adminMain.locator('[name="displayName"]')).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      assert.equal(createCalls, 0);
      await adminMain.getByLabel("Artist display name").fill("Synthetic Nepali artist");
      await adminMain.getByLabel("Public profile slug").fill("synthetic-nepali-artist");
      await adminMain
        .getByLabel("Biography", { exact: true })
        .fill("Synthetic cultural documentation from Patan.");
      await adminMain.getByLabel("Region", { exact: true }).fill("Patan");
      await adminMain
        .getByLabel("Art traditions (one per line)")
        .fill("Paubha\nThangka");
      await adminMain
        .getByRole("button", { name: "Create artist profile", exact: true })
        .click();
      await expect(adminMain.getByRole("alert")).toContainText("slug already exists");
      await expect(adminMain).not.toContainText("PRIVATE_ADMIN_SENTINEL");
      await expect(adminMain.getByLabel("Artist display name")).toHaveValue(
        "Synthetic Nepali artist",
      );
      await audit("artist creation conflict");
      await adminMain
        .getByRole("button", { name: "Create artist profile", exact: true })
        .click();
      await expect(adminMain).toContainText("Artist profile saved");
      assert.equal(createCalls, 2);
      assert.equal(savedArtist.creatorWallet, null);
      assert.equal(savedArtist.payoutWallet, null);
      const approveArtist = adminMain.getByRole("button", {
        name: "Record artist verification",
        exact: true,
      });
      await expect(approveArtist).toBeDisabled();
      await adminMain.getByLabel("Artist UUID", { exact: true }).fill(savedArtist.id);
      await adminMain
        .getByRole("button", { name: "Load artist profile", exact: true })
        .click();
      await expect(approveArtist).toBeDisabled();
      await audit("saved artist review");
      await page.evaluate(() => globalThis.scrollTo(0, 0));
      await page.screenshot({
        path: `${artifacts}/admin-review-${width}.png`,
        fullPage: true,
      });
      await adminMain.getByRole("checkbox").check();
      await approveArtist.click();
      await expect(adminMain).toContainText("Artist profile verified");
      await expect(
        adminMain.getByRole("link", { name: "View public artist profile" }),
      ).toHaveAttribute("href", "/artists/synthetic-nepali-artist");
      assert.equal(approvalCalls, 1);
      await audit("artist verified");
      await page.evaluate(() => globalThis.scrollTo(0, 0));
      await page.screenshot({
        path: `${artifacts}/admin-${width}.png`,
        fullPage: true,
      });

      await adminMain
        .getByRole("link", { name: "Artwork drafts", exact: true })
        .click();
      await expect(adminMain).toContainText("Showing 1–20 unpublished artworks");
      await expect(adminMain).toContainText("Artist verification pending");
      await expect(adminMain).toContainText("Lifecycle started");
      await expect(
        adminMain.getByRole("button", { name: "Previous draft page" }),
      ).toBeDisabled();
      await audit("draft list ready");
      await adminMain.getByRole("button", { name: "Next draft page" }).click();
      await expect(adminMain).toContainText("Showing 21–21 unpublished artworks");
      await expect(adminMain).toContainText("Synthetic second-page draft");
      await expect(
        adminMain.getByRole("button", { name: "Next draft page" }),
      ).toBeDisabled();
      await audit("draft list next page");
      await page.evaluate(() => globalThis.scrollTo(0, 0));
      await page.screenshot({
        path: `${artifacts}/draft-list-${width}.png`,
        fullPage: true,
      });
      await adminMain.getByRole("button", { name: "Previous draft page" }).click();
      await expect(adminMain).toContainText("Showing 1–20 unpublished artworks");
      await adminMain.getByRole("link", { name: "Document new artwork" }).click();
      await expect(
        adminMain.getByRole("button", { name: "Create artwork draft" }),
      ).toBeVisible();
      await audit("draft editor new");
      await adminMain.getByRole("button", { name: "Create artwork draft" }).click();
      await expect(adminMain.locator('[name="artistId"]')).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      assert.equal(draftCreateCalls, 0);
      await audit("draft editor validation");
      for (const [name, value] of Object.entries({
        artistId: "bbbbbbbb-1111-4111-8111-111111111111",
        category: "PAUBHA",
        creationYear: "2026",
        title: "Synthetic documented Paubha",
        materials: "Silk\nMineral pigment",
        story: "Approved synthetic cultural story",
        heightMm: "300",
        widthMm: "200",
      }))
        await adminMain.locator(`[name="${name}"]`).fill(value);
      await adminMain.getByRole("button", { name: "Create artwork draft" }).click();
      await expect(adminMain).toContainText("Artwork documentation saved");
      assert.equal(draftCreateCalls, 1);
      assert.ok(retainedCreationId);
      await expect(adminMain.locator('[name="artistId"]')).toHaveCount(0);
      await expect(adminMain).toContainText("KATHA-PAUBHA-000050");
      await audit("draft editor created");
      await adminMain.getByRole("link", { name: "Open saved documentation" }).click();
      await expect(adminMain.getByRole("heading", { level: 1 })).toHaveText(
        "Artwork documentation",
      );
      await expect(adminMain.locator('[name="story"]')).toHaveValue(
        "Approved synthetic cultural story",
      );
      await audit("draft editor loaded by permanent ID");
      await adminMain
        .locator('[name="story"]')
        .fill("Revised synthetic cultural story");
      await adminMain
        .getByRole("button", { name: "Save artwork documentation" })
        .click();
      await expect(adminMain.getByRole("alert")).toContainText(
        "draft changed or editing has closed",
      );
      await expect(
        adminMain.getByRole("button", { name: "Save artwork documentation" }),
      ).toBeDisabled();
      await expect(adminMain.locator('[name="story"]')).toHaveValue(
        "Revised synthetic cultural story",
      );
      await expect(adminMain).not.toContainText("PRIVATE_SAVE_SENTINEL");
      await audit("draft editor conflict");
      rejectDraftSave = false;
      await adminMain.getByRole("button", { name: "Reload saved draft" }).click();
      await expect(adminMain.locator('[name="story"]')).toHaveValue(
        "Approved synthetic cultural story",
      );
      await adminMain
        .locator('[name="story"]')
        .fill("Revised synthetic cultural story");
      await adminMain
        .getByRole("button", { name: "Save artwork documentation" })
        .click();
      await expect(adminMain).toContainText("Artwork documentation saved");
      await expect(adminMain.locator('[name="story"]')).toHaveValue(
        "Revised synthetic cultural story",
      );
      await audit("draft editor saved");
      await adminMain.getByRole("link", { name: "Manage artwork media" }).click();
      await expect(adminMain).toContainText("No artwork files yet");
      await audit("media empty");
      await adminMain.getByRole("button", { name: "Upload artwork file" }).click();
      await expect(adminMain.locator('[name="file"]')).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      assert.equal(mediaWrites, 0);
      await audit("media upload validation");
      for (const caption of [
        "Synthetic front photograph",
        "Synthetic detail photograph",
      ]) {
        await adminMain.locator('[name="file"]').setInputFiles({
          name: "synthetic.png",
          mimeType: "image/png",
          buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
            "base64",
          ),
        });
        await adminMain.locator('[name="caption"]').fill(caption);
        await adminMain.getByRole("button", { name: "Upload artwork file" }).click();
        await expect(adminMain).toContainText("Artwork media saved");
        await expect(adminMain.locator('[name="file"]')).toHaveValue("");
      }
      assert.equal(mediaWrites, 2);
      await expect(adminMain).toContainText("Stored visibility: Private");
      await audit("media private uploads");
      await adminMain.getByRole("button", { name: "Move file 2 earlier" }).click();
      await expect(
        adminMain.getByRole("status").filter({ hasText: "File moved" }),
      ).toContainText("position 1");
      await adminMain.getByRole("button", { name: "Save media choices" }).click();
      await expect(adminMain.getByRole("alert")).toContainText(
        "could not be confirmed",
      );
      await expect(
        adminMain.getByRole("button", { name: "Save media choices" }),
      ).toBeDisabled();
      await expect(adminMain).not.toContainText("PRIVATE_MEDIA_SENTINEL");
      await audit("media conflict");
      rejectMediaSave = false;
      await adminMain.getByRole("button", { name: "Reload media" }).click();
      await expect(
        adminMain.getByRole("button", { name: "Save media choices" }),
      ).toBeEnabled();
      await adminMain.getByRole("button", { name: "Move file 2 earlier" }).click();
      const publicId = mediaPage.items[1].id;
      await adminMain.locator(`[name="visibility:${publicId}"]`).selectOption("PUBLIC");
      await adminMain.getByRole("button", { name: "Save media choices" }).click();
      await expect(
        adminMain.locator(`[name="approvedPublic:${publicId}"]`),
      ).toHaveAttribute("aria-invalid", "true");
      assert.equal(mediaWrites, 2);
      await adminMain.locator(`[name="approvedPublic:${publicId}"]`).check();
      await adminMain
        .locator(`[name="altText:${publicId}"]`)
        .fill("Approved synthetic photograph of Nepali artwork");
      await adminMain.getByRole("button", { name: "Save media choices" }).click();
      await expect(adminMain).toContainText("Stored visibility: Public");
      assert.equal(mediaWrites, 3);
      assert.equal(mediaPage.items[0].id, publicId);
      await audit("media approved and reordered");
      mediaPage.editable = false;
      await adminMain.getByRole("button", { name: "Reload media" }).click();
      await expect(adminMain).toContainText("Media editing is closed");
      await expect(
        adminMain.getByRole("button", { name: "Upload artwork file" }),
      ).toBeDisabled();
      await audit("media frozen");
      await page.evaluate(() => globalThis.scrollTo(0, 0));
      await page.screenshot({
        path: `${artifacts}/media-admin-${width}.png`,
        fullPage: true,
      });
      await adminMain
        .getByRole("link", { name: "Artwork documentation", exact: true })
        .click();
      await expect(adminMain.locator('[name="story"]')).toHaveValue(
        "Revised synthetic cultural story",
      );
      await adminMain.getByRole("link", { name: "Register artwork on chain" }).click();
      await expect(adminMain.getByRole("heading", { level: 1 })).toHaveText(
        "Artwork registration",
      );
      await expect(
        adminMain.getByRole("button", { name: "Prepare canonical metadata" }),
      ).toBeEnabled();
      await audit("registration without metadata");
      await adminMain
        .getByRole("button", { name: "Prepare canonical metadata" })
        .click();
      await expect(adminMain).toContainText("Exact saved bytes and SHA-256 verified");
      assert.equal(metadataCalls, 1);
      const registrationPrepare = adminMain.getByRole("button", {
        name: "Prepare and simulate registration",
      });
      await expect(registrationPrepare).toBeDisabled();
      await adminMain
        .getByText("Review exact canonical document", { exact: true })
        .click();
      await expect(adminMain.locator("pre")).toContainText(
        "Approved synthetic cultural story",
      );
      await audit("registration canonical review");
      await adminMain.getByRole("checkbox").check();
      await registrationPrepare.click();
      await expect(adminMain.getByRole("alert")).toContainText("Reload saved state");
      await expect(adminMain).not.toContainText("PRIVATE_REGISTRATION_ERROR");
      await audit("registration conflict");
      rejectRegistration = false;
      await adminMain
        .getByRole("button", { name: "Reload registration state" })
        .click();
      await adminMain.getByRole("checkbox").check();
      await registrationPrepare.click();
      await expect(adminMain).toContainText(
        "Review transaction before wallet approval",
      );
      assert.equal(registrationCalls, 2);
      assert.equal(registrationSimulations, 1);
      await expect(
        adminMain.getByRole("button", { name: "Approve in wallet and submit" }),
      ).toBeVisible();
      await audit("registration simulated before approval");
      await adminMain
        .getByRole("button", { name: "Cancel transaction review" })
        .click();
      registrationPage.registration = {
        finalized: false,
        unresolved: true,
        receipt: {
          status: "UNKNOWN",
          signature: "3".repeat(88),
          slot: null,
          indexed: false,
        },
      };
      await adminMain
        .getByRole("button", { name: "Reload registration state" })
        .click();
      await expect(adminMain).toContainText("A retained signature is unresolved");
      await expect(adminMain.getByRole("checkbox")).toBeDisabled();
      await audit("registration unresolved receipt");
      registrationPage.registration = {
        finalized: true,
        unresolved: false,
        receipt: {
          status: "FINALIZED",
          signature: "3".repeat(88),
          slot: "20",
          indexed: false,
        },
      };
      await adminMain
        .getByRole("button", { name: "Reload registration state" })
        .click();
      await expect(adminMain).toContainText("Finalized; registration indexing pending");
      await audit("registration finalized indexing delay");
      registrationPage.registration.receipt.indexed = true;
      await adminMain
        .getByRole("button", { name: "Reload registration state" })
        .click();
      await expect(adminMain).toContainText("Registration event indexed");
      await audit("registration indexed");
      await page.evaluate(() => globalThis.scrollTo(0, 0));
      await page.screenshot({
        path: `${artifacts}/registration-admin-${width}.png`,
        fullPage: true,
      });
      // Verifier-only review requires no administrative draft or media access.
      adminAllowed = false;
      verifierAllowed = true;
      await adminMain
        .getByRole("link", { name: "Review artwork authenticity", exact: true })
        .click();
      const authenticityPrepare = adminMain.getByRole("button", {
        name: "Prepare and simulate verification",
      });
      await expect(adminMain).toContainText(
        "No finalized artwork verification recorded.",
      );
      await expect(authenticityPrepare).toBeDisabled();
      await audit("verification manual review");
      await adminMain.getByLabel("Reviewed evidence SHA-256").fill("f".repeat(64));
      await adminMain.getByLabel("I physically inspected", { exact: false }).check();
      await adminMain
        .getByLabel("I reviewed the artist attribution", { exact: false })
        .check();
      await expect(authenticityPrepare).toBeDisabled();
      await expect(adminMain).toContainText("does not match the registered commitment");
      await audit("verification evidence mismatch");
      await adminMain.getByLabel("Reviewed evidence SHA-256").fill("e".repeat(64));
      await authenticityPrepare.click();
      await expect(adminMain.getByRole("alert")).toContainText("Reload saved state");
      await expect(adminMain).not.toContainText("PRIVATE_VERIFICATION_ERROR");
      await audit("verification stale state");
      rejectArtworkVerification = false;
      await adminMain
        .getByRole("button", { name: "Reload verification state" })
        .click();
      await adminMain.getByLabel("Reviewed evidence SHA-256").fill("e".repeat(64));
      await adminMain.getByLabel("I physically inspected", { exact: false }).check();
      await adminMain
        .getByLabel("I reviewed the artist attribution", { exact: false })
        .check();
      await authenticityPrepare.click();
      await expect(
        adminMain.getByRole("button", { name: "Approve in wallet and submit" }),
      ).toBeVisible();
      assert.equal(verificationCalls, 2);
      await audit("verification simulated before approval");
      await adminMain
        .getByRole("button", { name: "Cancel transaction review" })
        .click();
      verificationPage = {
        ...verificationPage,
        verification: {
          finalized: false,
          unresolved: true,
          receipt: {
            status: "UNKNOWN",
            signature: "4".repeat(88),
            slot: null,
            indexed: false,
          },
        },
      };
      await adminMain
        .getByRole("button", { name: "Reload verification state" })
        .click();
      await expect(adminMain).toContainText(
        "A retained verification signature is unresolved",
      );
      await expect(authenticityPrepare).toBeDisabled();
      await audit("verification unresolved receipt");
      verificationPage.verification = {
        finalized: true,
        unresolved: false,
        receipt: {
          status: "FINALIZED",
          signature: "4".repeat(88),
          slot: "10",
          indexed: false,
        },
      };
      await adminMain
        .getByRole("button", { name: "Reload verification state" })
        .click();
      await expect(adminMain).toContainText("Artwork verification finalized.");
      await expect(adminMain).toContainText(
        "Finalized; verification indexing pending.",
      );
      await audit("verification finalized indexing pending");
      verificationPage.verification.receipt.indexed = true;
      await adminMain
        .getByRole("button", { name: "Reload verification state" })
        .click();
      await expect(adminMain).toContainText("Verification event indexed.");
      await audit("verification indexed");
      await page.screenshot({
        path: `${artifacts}/verification-admin-${width}.png`,
        fullPage: true,
      });
      await adminMain
        .getByRole("link", { name: "Open condition inspection", exact: true })
        .click();
      await expect(
        adminMain.getByRole("heading", {
          name: "Condition inspection",
          exact: true,
        }),
      ).toBeVisible();
      const conditionSave = adminMain.getByRole("button", {
        name: "Save private condition report",
        exact: true,
      });
      await expect(conditionSave).toBeDisabled();
      await audit("inspection protected initial scope");
      await adminMain.getByLabel("Inspection image", { exact: true }).setInputFiles({
        name: "synthetic.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      });
      await adminMain
        .getByRole("button", { name: "Upload private evidence", exact: true })
        .click();
      await expect(adminMain.getByText("Evidence 2", { exact: false })).toBeVisible();
      await adminMain
        .getByLabel("Actual inspection date and time (your local timezone)", {
          exact: true,
        })
        .fill("2026-10-05T10:00");
      await adminMain
        .getByLabel("Private condition notes", { exact: true })
        .fill("Synthetic private browser inspection notes");
      await adminMain.getByRole("checkbox", { name: /Evidence 2/ }).check();
      await adminMain
        .getByRole("checkbox", {
          name: /I physically inspected this artwork and approve these notes/,
        })
        .check();
      await conditionSave.click();
      await expect(adminMain).toContainText("Saved private report · Version 2");
      await adminMain
        .getByText("Review exact private canonical report", { exact: true })
        .click();
      await expect(adminMain).toContainText(
        "Synthetic private browser inspection notes",
      );
      await audit("inspection private document review");
      const conditionPrepare = adminMain.getByRole("button", {
        name: "Prepare and simulate condition attestation",
        exact: true,
      });
      const conditionApproval = adminMain.getByRole("checkbox", {
        name: /I reviewed the exact saved report and hash/,
      });
      await conditionApproval.check();
      await conditionPrepare.click();
      await expect(adminMain.getByRole("alert")).toContainText("changed");
      await expect(adminMain).not.toContainText("PRIVATE_INSPECTION_ERROR");
      await audit("inspection stale preparation");
      rejectInspection = false;
      await adminMain
        .getByRole("button", { name: "Reload inspection state", exact: true })
        .click();
      await conditionApproval.check();
      await conditionPrepare.click();
      await expect(
        adminMain.getByRole("heading", {
          name: "Condition attestation transaction review",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        adminMain.getByRole("button", {
          name: "Approve in wallet and submit",
          exact: true,
        }),
      ).toBeEnabled();
      assert.equal(inspectionCalls, 2);
      await audit("inspection simulation before wallet approval");
      await adminMain
        .getByRole("button", { name: "Cancel transaction review", exact: true })
        .click();
      inspectionPage = {
        ...inspectionPage,
        unresolved: true,
        attestation: {
          finalized: false,
          unresolved: true,
          receipt: {
            status: "UNKNOWN",
            signature: "6".repeat(88),
            slot: null,
            indexed: false,
          },
        },
      };
      await adminMain
        .getByRole("button", { name: "Reload inspection state", exact: true })
        .click();
      await expect(adminMain).toContainText(
        "A retained condition signature is unresolved",
      );
      await expect(conditionPrepare).toBeDisabled();
      await expect(conditionSave).toBeDisabled();
      await audit("inspection unresolved signature");
      inspectionPage = {
        ...inspectionPage,
        unresolved: false,
        attestation: {
          finalized: true,
          unresolved: false,
          receipt: {
            status: "FINALIZED",
            signature: "6".repeat(88),
            slot: "10",
            indexed: false,
          },
        },
      };
      await adminMain
        .getByRole("button", { name: "Reload inspection state", exact: true })
        .click();
      await expect(adminMain).toContainText("Finalized; condition indexing pending.");
      await audit("inspection finalized indexing pending");
      inspectionPage.attestation.receipt.indexed = true;
      await adminMain
        .getByRole("button", { name: "Reload inspection state", exact: true })
        .click();
      await expect(adminMain).toContainText("Condition event indexed.");
      await audit("inspection indexed");
      await page.screenshot({
        path: `${artifacts}/condition-admin-${width}.png`,
        fullPage: true,
      });
      adminAllowed = true;
      await adminMain
        .getByRole("link", { name: "Custody coordination", exact: true })
        .click();
      await expect(adminMain).toContainText("katha held · revision 1");
      await expect(
        adminMain.getByRole("heading", { name: "Custody coordination", exact: true }),
      ).toHaveCount(1);
      await audit("custody administration");
      await adminMain
        .getByRole("link", { name: "Mint and publish", exact: true })
        .click();
      await expect(adminMain).toContainText("Not minted");
      await audit("Core mint review");
      const prepareMint = adminMain.getByRole("button", {
        name: "Prepare Core mint",
        exact: true,
      });
      await expect(prepareMint).toBeDisabled();
      await adminMain
        .getByLabel(
          "I reviewed the public metadata, verified initial inspection and custody, and the configured collection and initial digital owner.",
        )
        .check();
      await prepareMint.click();
      await expect(adminMain).toContainText(
        "Review transaction before wallet approval",
      );
      assert.equal(mintPreparations, 1);
      assert.equal(publications, 0);
      await audit("mint simulation requires separate wallet approval");
      await adminMain
        .getByRole("button", { name: "Cancel transaction review", exact: true })
        .click();
      mintPage.canMint = false;
      mintPage.chain.minted = true;
      mintPage.chain.owner = mintFixtureData.operation.feePayer;
      mintPage.blockedReasons = ["INDEXING_PENDING"];
      await adminMain
        .getByRole("button", { name: "Reload saved state", exact: true })
        .click();
      const publishArtwork = adminMain.getByRole("button", {
        name: "Publish artwork",
        exact: true,
      });
      await expect(publishArtwork).toBeDisabled();
      await audit("publication waits for indexing");
      mintPage.canPublish = true;
      mintPage.blockedReasons = [];
      mintPage.mint = {
        finalized: true,
        unresolved: false,
        receipt: {
          status: "FINALIZED",
          signature: "AB".repeat(44),
          slot: "10",
          indexed: true,
        },
      };
      await adminMain
        .getByRole("button", { name: "Reload saved state", exact: true })
        .click();
      await expect(publishArtwork).toBeDisabled();
      await adminMain
        .getByLabel(
          "I reviewed the finalized asset and approved public artwork documentation for publication.",
        )
        .check();
      await publishArtwork.click();
      await expect(adminMain.getByRole("alert")).toContainText("Reload saved state");
      await expect(publishArtwork).toBeDisabled();
      assert.equal(publications, 1);
      await audit("publication conflict requires reload");
      rejectPublication = false;
      await adminMain
        .getByRole("button", { name: "Reload saved state", exact: true })
        .click();
      await adminMain
        .getByLabel(
          "I reviewed the finalized asset and approved public artwork documentation for publication.",
        )
        .check();
      await publishArtwork.click();
      await expect(
        adminMain.getByRole("link", { name: "View published artwork", exact: true }),
      ).toHaveAttribute("href", `/art/${mintPage.kathaId}`);
      assert.equal(publications, 2);
      await audit("explicit verified publication");
      await page.screenshot({
        path: `${artifacts}/mint-admin-${width}.png`,
        fullPage: true,
      });
      adminAllowed = false;
      await adminMain
        .getByRole("button", { name: "Reload saved state", exact: true })
        .click();
      await expect(adminMain.getByRole("alert")).toContainText("administrator session");
      await expect(adminMain).not.toContainText(mintPage.metadata.canonicalDocument);
      await audit("mint permission revoked clears review");
      adminAllowed = true;
      await adminMain
        .getByRole("link", { name: "Custody coordination", exact: true })
        .click();
      await expect(adminMain).toContainText("katha held · revision 1");
      const fulfillmentDetails = adminMain
        .locator("details")
        .filter({ hasText: "delivery · requested" });
      await fulfillmentDetails.locator("summary").click();
      await expect(fulfillmentDetails).toContainText("synthetic@example.invalid");
      const fulfillmentSave = adminMain.getByRole("button", {
        name: "Save fulfillment status",
        exact: true,
      });
      await expect(fulfillmentSave).toBeDisabled();
      await adminMain
        .getByLabel("Fulfillment status", { exact: true })
        .selectOption("APPROVED");
      await adminMain.getByLabel("Courier", { exact: true }).fill("Synthetic courier");
      await adminMain
        .getByRole("checkbox", {
          name: "I confirmed this fulfillment status manually.",
          exact: false,
        })
        .check();
      await fulfillmentSave.click();
      await expect(adminMain.getByRole("alert")).toContainText("Reload saved state");
      await expect(fulfillmentSave).toBeDisabled();
      await audit("fulfillment conflict");
      rejectFulfillment = false;
      await adminMain
        .getByRole("button", { name: "Reload custody state", exact: true })
        .click();
      await fulfillmentDetails.locator("summary").click();
      await adminMain
        .getByLabel("Fulfillment status", { exact: true })
        .selectOption("APPROVED");
      await adminMain.getByLabel("Courier", { exact: true }).fill("Synthetic courier");
      await adminMain
        .getByRole("checkbox", {
          name: "I confirmed this fulfillment status manually.",
          exact: false,
        })
        .check();
      await fulfillmentSave.click();
      await expect.poll(() => fulfillmentWrites).toBe(2);
      await expect(adminMain).toContainText("delivery · approved");
      await expect(adminMain).toContainText("katha held · revision 1");
      assert.equal(custodyPreparations, 0);
      await audit("fulfillment approval separate from custody");
      await adminMain
        .getByLabel("Related fulfillment request", { exact: true })
        .selectOption(custodyPage.requests[0].request.id);
      await adminMain
        .getByLabel("Physical movement", { exact: true })
        .selectOption("DISPATCH_FROM_KATHA");
      const custodyPrepare = adminMain.getByRole("button", {
        name: "Prepare custody attestation",
        exact: true,
      });
      await expect(custodyPrepare).toBeDisabled();
      await adminMain
        .getByRole("checkbox", {
          name: "I confirmed that this physical movement has already occurred",
          exact: false,
        })
        .check();
      await custodyPrepare.click();
      await expect(adminMain).toContainText(
        "Review transaction before wallet approval",
      );
      assert.equal(custodyPreparations, 1);
      await audit("custody transaction review");
      await page.screenshot({
        path: `${artifacts}/custody-admin-${width}.png`,
        fullPage: true,
      });
      await adminMain
        .getByRole("button", { name: "Cancel transaction review", exact: true })
        .click();
      custodyPage.custody.unresolved = true;
      await adminMain
        .getByRole("button", { name: "Reload custody state", exact: true })
        .click();
      await expect(adminMain).toContainText("A signed custody attempt is unresolved");
      await expect(custodyPrepare).toBeDisabled();
      await audit("custody unresolved signature");
      custodyPage.custody.unresolved = false;
      custodyPage.canAttest = false;
      await adminMain
        .getByRole("button", { name: "Reload custody state", exact: true })
        .click();
      await expect(adminMain).toContainText(
        "current Registry custody authority must sign",
      );
      await expect(custodyPrepare).toBeDisabled();
      await audit("custody administrator without chain authority");
      adminAllowed = false;
      await adminMain
        .getByRole("button", { name: "Reload custody state", exact: true })
        .click();
      await expect(adminMain.getByRole("alert")).toContainText("administrator session");
      await expect(adminMain).not.toContainText("synthetic@example.invalid");
      await expect(adminMain).not.toContainText("Synthetic address");
      await audit("custody role revoked clears private details");
      await adminMain
        .getByRole("link", { name: "Artwork authenticity", exact: true })
        .click();
      await adminMain
        .getByRole("link", { name: "Open condition inspection", exact: true })
        .click();
      verifierAllowed = false;
      await adminMain
        .getByRole("button", { name: "Reload inspection state", exact: true })
        .click();
      await expect(adminMain).not.toContainText(
        "Synthetic private browser inspection notes",
      );
      await expect(adminMain.getByRole("alert")).toContainText("A verifier session");
      await audit("inspection permission revoked");
      verifierAllowed = true;
      await adminMain
        .getByRole("link", { name: "Artwork authenticity", exact: true })
        .click();
      verifierAllowed = false;
      await adminMain
        .getByRole("button", { name: "Reload verification state" })
        .click();
      await expect(adminMain.getByRole("alert")).toContainText("A verifier session");
      await expect(adminMain).not.toContainText("Synthetic Nepali artwork");
      await audit("verification authority revoked");
      adminAllowed = true;
      verifierAllowed = true;
      await adminMain
        .getByRole("link", { name: "Artwork documentation", exact: true })
        .click();
      freezeDraft = true;
      await adminMain.getByRole("button", { name: "Reload saved draft" }).click();
      await expect(adminMain).toContainText("Editing is closed");
      await expect(
        adminMain.getByRole("button", { name: "Save artwork documentation" }),
      ).toBeDisabled();
      await audit("draft editor frozen");
      await page.evaluate(() => globalThis.scrollTo(0, 0));
      await page.screenshot({
        path: `${artifacts}/draft-editor-${width}.png`,
        fullPage: true,
      });
      await adminMain
        .getByRole("link", { name: "Artwork drafts", exact: true })
        .click();
      await expect(adminMain).toContainText("Showing 1–20 unpublished artworks");
      draftMode = "UNAVAILABLE";
      await adminMain.getByRole("button", { name: "Refresh drafts" }).click();
      await expect(adminMain.getByRole("alert")).toContainText("could not be loaded");
      await expect(adminMain).not.toContainText("Synthetic unpublished work");
      await expect(adminMain).not.toContainText("PRIVATE_DRAFT_SENTINEL");
      await audit("draft list unavailable");
      draftMode = "EMPTY";
      await adminMain.getByRole("button", { name: "Try loading drafts again" }).click();
      await expect(adminMain).toContainText("No unpublished artworks on this page");
      await audit("draft list empty");
      draftMode = "DENIED";
      await adminMain.getByRole("button", { name: "Refresh drafts" }).click();
      await expect(adminMain.getByRole("alert")).toContainText(
        "Access is no longer available",
      );
      await audit("draft list permission revoked");
      await adminMain
        .getByRole("link", { name: "Artist administration", exact: true })
        .click();
      await expect(adminMain).toContainText("Create an artist profile");
      await walletPanel.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(walletPanel.getByRole("status")).toHaveText("Not signed in");
      await expect.poll(() => logoutCalls).toBe(1);
      await expect(adminMain).toContainText("Sign in to administer Katha");
      await expect(adminMain).not.toContainText("Synthetic Nepali artist");
      await audit("admin signed out");
      adminAllowed = false;
      verifierAllowed = false;

      await walletPanel
        .getByRole("button", { name: "Sign in to Katha", exact: true })
        .click();
      await expect(walletPanel.getByRole("status")).toHaveText("Signed in to Katha");
      await expect(adminMain).toContainText("no applicable administration permission");
      await audit("admin permission denied");
      await page.getByRole("link", { name: "Katha home", exact: true }).click();
      await walletPanel
        .getByLabel("Wallet account")
        .selectOption("11111111111111111111111111111111");
      await expect(walletPanel.getByRole("status")).toHaveText("Not signed in");
      await expect.poll(() => logoutCalls).toBe(2);
      assert.equal(verifyCalls, 3);
      await audit("wallet connected");
      await walletPanel.screenshot({ path: `${artifacts}/wallet-${width}.png` });
      await walletPanel.getByRole("button", { name: "Disconnect wallet" }).click();
      await expect(
        walletPanel.getByRole("button", { name: "Connect Synthetic test wallet" }),
      ).toBeVisible();
      await walletPanel
        .getByRole("button", { name: "Connect Synthetic test wallet" })
        .click();
      await page.evaluate(() => globalThis.__kathaWalletTest.unregister());
      await expect(walletPanel).toContainText("No compatible Solana wallet found");
      assert.equal(
        await page.evaluate(() => globalThis.__kathaWalletTest.signCalls()),
        3,
      );
      assert.equal(
        await page.evaluate(() => globalThis.__kathaWalletTest.transactionCalls()),
        0,
      );
      await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
      // Restart keyboard traversal from a fresh document after wallet controls.
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Connect wallet", exact: true }),
      ).toBeVisible();
      await audit("home");
      await page.screenshot({ path: `${artifacts}/home-${width}.png`, fullPage: true });

      // The skip link must be first, visible on keyboard focus, and move focus.
      await page.keyboard.press("Tab");
      const skip = page.getByRole("link", { name: "Skip to content" });
      await expect(skip).toBeFocused();
      assert.ok((await skip.boundingBox()).y >= 0);
      assert.equal(
        await skip.evaluate(
          (element) => globalThis.getComputedStyle(element).outlineStyle,
        ),
        "solid",
      );
      await page.keyboard.press("Enter");
      await expect(page.getByRole("main")).toBeFocused();

      const nav = page.getByRole("navigation", { name: "Primary", exact: true });
      for (const [name, id] of [
        ["Our purpose", "purpose"],
        ["Traditions", "traditions"],
      ]) {
        const link = nav.getByRole("link", { name, exact: true });
        await link.focus();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(new RegExp(`#${id}$`));
        await expect(page.locator(`#${id}`)).toBeFocused();
      }
      const explore = nav.getByRole("link", { name: "Explore", exact: true });
      assert.ok((await explore.boundingBox()).height >= 44);
      await explore.click();
      await expect(page).toHaveURL(`${origin}/explore`);
      await audit("catalogue");
      await page
        .getByRole("navigation", { name: "Artwork categories" })
        .getByRole("link", { name: "Paubha", exact: true })
        .click();
      await expect(page).toHaveURL(`${origin}/explore?category=PAUBHA`);
      await expect(
        page.getByRole("link", { name: "Paubha", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await page.locator('main a[href="/art/KATHA-PAUBHA-000001"]').click();
      await expect(page).toHaveURL(`${origin}/art/KATHA-PAUBHA-000001`);
      await expect(page.locator("#artwork-title")).toBeVisible();
      const identity = page.locator(
        'section[aria-labelledby="artwork-physical-identity"]',
      );
      await expect(
        identity.getByRole("heading", { name: "Physical identity and NFC" }),
      ).toBeVisible();
      await expect(identity).toContainText("A basic NFC tag can be cloned");
      await expect(
        identity.getByRole("link", { name: "KATHA-PAUBHA-000001", exact: true }),
      ).toHaveAttribute("href", "/art/KATHA-PAUBHA-000001");
      for (const [name, id] of [
        ["About the work", "artwork-details"],
        ["recorded manual verification", "artwork-authenticity"],
        ["latest available condition inspection", "artwork-condition"],
        ["provenance and blockchain references", "artwork-provenance"],
      ]) {
        await identity.getByRole("link", { name, exact: true }).click();
        await expect(page).toHaveURL(`${origin}/art/KATHA-PAUBHA-000001#${id}`);
        await expect(page.locator(`#${id}`)).toBeInViewport();
      }
      await audit("artwork");
      const photo = page
        .getByRole("img", { name: "Synthetic artwork image for testing" })
        .first();
      await expect(photo).toBeVisible();
      await expect
        .poll(() => photo.evaluate((element) => element.naturalWidth))
        .toBeGreaterThan(0);
      assert.equal(
        await photo.evaluate(
          (element) => globalThis.getComputedStyle(element).objectFit,
        ),
        "contain",
      );
      await page.screenshot({
        path: `${artifacts}/artwork-${width}.png`,
        fullPage: true,
      });
      await page.locator('main a[href="/artists/synthetic-artist"]').first().click();
      await expect(page.locator("#artist-name")).toBeVisible();
      await audit("artist");
      await nav.getByRole("link", { name: "Traditions", exact: true }).click();
      await expect(page.locator("#traditions")).toBeFocused();
      await expect(page).toHaveURL(`${origin}/#traditions`);
      assert.deepEqual(
        pageErrors,
        [],
        "healthy journey must hydrate without browser exceptions",
      );

      // Long unbroken public text must wrap rather than widen the document.
      setLongContent(true);
      for (const path of ["/", "/explore", "/artists/synthetic-artist"]) {
        await page.goto(`${origin}${path}`);
        await audit(`long content ${path}`);
      }
      setLongContent(false);
      await page.goto(origin);
      await page.evaluate(() => {
        globalThis.document.documentElement.style.fontSize = "200%";
      });
      await audit("200 percent text size");
      await page.evaluate(() => {
        globalThis.document.documentElement.style.fontSize = "";
      });
      assert.ok(
        await page
          .locator(".button-primary")
          .first()
          .evaluate((element) =>
            globalThis
              .getComputedStyle(element)
              .transitionDuration.split(",")
              .every((value) => value.trim() === "0s"),
          ),
      );
      for (const [category, message] of [
        ["THANGKA", "No published artworks"],
        ["MANDALA", "Artworks are unavailable right now"],
      ]) {
        await page.goto(`${origin}/explore?category=${category}`);
        // The existing empty catalogue describes the currently matched query.
        await expect(page.getByRole("main")).toContainText(message);
        await audit(`catalogue ${category}`);
      }

      await page.goto(`${origin}/art/KATHA-PAUBHA-999999`);
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
        "content",
        /noindex/,
      );
      await audit("unknown artwork");
      await page.getByRole("link", { name: "Return home" }).click();
      await expect(page.locator("#purpose")).toBeVisible();

      setArtworkOutage(true);
      await page.goto(`${origin}/art/KATHA-PAUBHA-000001`);
      await expect(
        page.getByRole("heading", { name: "We couldn’t load this page" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
      assert.ok(
        !(await page.locator("body").innerText()).includes("PRIVATE_UPSTREAM_SENTINEL"),
      );
      await audit("artwork API outage");
      setArtworkOutage(false);
      await page.getByRole("button", { name: "Try again" }).click();
      await expect(page.locator("#artwork-title")).toBeVisible();
      await audit("recovered artwork API");
      await nav.getByRole("link", { name: "Home", exact: true }).click();
      await expect(page.locator("#purpose")).toBeVisible();

      for (const [mode, message] of [
        ["EMPTY", "No published artworks are available yet."],
        ["UNAVAILABLE", "Featured artworks are temporarily unavailable."],
      ]) {
        setHomeMode(mode);
        await page.goto(origin);
        await expect(
          page.getByRole("main").getByText(message, { exact: false }),
        ).toBeVisible();
        await audit(`home ${mode}`);
      }
      setHomeMode("READY");
      await page.route("**/storage/public/*.png", (route) => route.abort());
      await page.goto(`${origin}/art/KATHA-PAUBHA-000001`);
      await expect(
        page.getByText("This photograph is unavailable.").first(),
      ).toBeVisible();
      await audit("failed photography");
      await page.goto(origin);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      for (const phase of [
        "review",
        "signing",
        "unknown",
        "expired",
        "failed",
        "indexing-delay",
        "indexed",
      ]) {
        await page.getByRole("main").evaluate((main, html) => {
          let target = main.querySelector("#synthetic-transaction-review");
          if (!target) {
            target = globalThis.document.createElement("div");
            target.id = "synthetic-transaction-review";
            main.append(target);
          }
          target.innerHTML = `<section><h2>Wallet operations</h2>${html}</section>`;
        }, renderTransactionReviewPhase(phase));
        const panel = page.locator("#synthetic-transaction-review");
        await expect(
          panel.getByRole("heading", { name: "Transaction review" }),
        ).toBeVisible();
        const approve = panel.getByRole("button", {
          name: "Approve in wallet and submit",
        });
        await expect(approve).toHaveCount(phase === "review" ? 1 : 0);
        if (phase === "review") {
          await approve.focus();
          await expect(approve).toBeFocused();
        }
        await audit(`transaction ${phase}`);
        if (phase === "review")
          await panel.screenshot({ path: `${artifacts}/transaction-${width}.png` });
      }
      await context.close();
    }
    globalThis.console.log(
      `Public browser journeys passed: Chromium, 320/768/1440px, ${scans} full-page axe scans, keyboard/anchors, navigation, wrapping, safe missing/outage states and photo failure. Screenshots are private under helper/build/reports/086/.`,
    );
  } finally {
    setHomeMode("READY");
    setLongContent(false);
    setArtworkOutage(false);
    await browser.close();
  }
}
