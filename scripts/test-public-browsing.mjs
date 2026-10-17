import { metadataFixture } from "../apps/web/tests/fixtures/metadata.ts";
import { mintingFixture } from "../apps/web/tests/fixtures/minting.ts";
import { custodyFixture } from "../apps/web/tests/fixtures/custody.ts";
import { conditionFixture } from "../apps/web/tests/fixtures/condition.ts";
import { canonicalDocumentBytes, sha256Hex } from "../packages/shared/dist/index.js";
import { verificationFixture } from "../apps/web/tests/fixtures/verification.ts";
import { registrationFixture } from "../apps/web/tests/fixtures/registration.ts";
import { resaleFixture } from "../apps/web/tests/fixtures/resale.ts";
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
        // Name the widest offending elements so an overflow failure is actionable.
        const overflow = await page.evaluate(() =>
          globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth
            ? []
            : [...globalThis.document.querySelectorAll("body *")]
                .filter((element) => {
                  if (
                    element.getBoundingClientRect().right <=
                    globalThis.innerWidth + 1
                  )
                    return false;
                  // Content inside a sideways-scrolling region is contained.
                  for (
                    let node = element.parentElement;
                    node;
                    node = node.parentElement
                  )
                    if (
                      ["auto", "scroll", "hidden"].includes(
                        globalThis.getComputedStyle(node).overflowX,
                      )
                    )
                      return node === globalThis.document.body;
                  return true;
                })
                .slice(0, 5)
                .map((element) =>
                  `${element.tagName.toLowerCase()}.${element.getAttribute("class") ?? ""}`.slice(
                    0,
                    80,
                  ),
                ),
        );
        assert.ok(
          await page.evaluate(
            () =>
              globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
          ),
          `${label} overflows at ${width}px: ${overflow.join(", ")}`,
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
      // Header links stay client-side so the in-memory wallet session survives.
      // The sticky header hides while reading; scrolling up brings it back, as for a reader.
      async function revealHeader() {
        const header = page.locator(".hdr, .dashboard-header");
        if ((await header.getAttribute("data-hidden")) !== "true") return;
        await page.mouse.wheel(0, -200);
        await expect(header).not.toHaveAttribute("data-hidden", "true");
      }
      async function headerLink(href) {
        await revealHeader();
        // Home-page section links are native fragments (#id), elsewhere /#id.
        const target = (scope) =>
          `${scope} a[href="${href}"], ${scope} a[href="${href.replace(/^\/#/, "#")}"]`;
        const menu = page.locator(".menubtn");
        if (await menu.isVisible()) {
          if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
          await page.locator(target("#mobile-navigation")).click();
        } else await page.locator(target(":is(.hdr .nav, .navi, .side-foot)")).click();
      }
      const main = page.getByRole("main");
      const alert = (text) => main.getByRole("alert").filter({ hasText: text }).first();
      const chooser = page.getByRole("dialog", { name: "Choose a wallet" });
      await page.goto(`${origin}/admin`);
      await expect(main.getByRole("heading", { level: 1 })).toHaveText(
        "Sign in to use operations",
      );
      await audit("operations signed out");
      await main.getByRole("link", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(`${origin}/account?next=%2Fadmin`);
      await main.getByRole("button", { name: "Connect wallet", exact: true }).click();
      await expect(chooser).toContainText("No compatible Solana wallet found");
      await chooser.getByRole("button", { name: "Close", exact: true }).click();
      await expect(chooser).toBeHidden();
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
              total: draftMode === "EMPTY" ? 0 : 21,
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
      // Tag bindings and workflow markers for the artwork workspace.
      let nfcListReads = 0,
        workflowReads = 0;
      await context.route(`${apiOrigin}/admin/artworks/*/nfc-tags`, async (route) => {
        if (route.request().method() === "OPTIONS")
          return route.fulfill({ status: 204, headers: adminHeaders });
        assert.equal(
          route.request().headers().authorization,
          `Bearer ${"a".repeat(64)}`,
        );
        nfcListReads++;
        const kathaId = new URL(route.request().url()).pathname.split("/")[3];
        return route.fulfill({ headers: adminHeaders, json: { kathaId, items: [] } });
      });
      for (const role of ["admin", "verifier"])
        await context.route(
          `${apiOrigin}/${role}/artworks/*/workflow`,
          async (route) => {
            if (route.request().method() === "OPTIONS")
              return route.fulfill({ status: 204, headers: adminHeaders });
            assert.equal(
              route.request().headers().authorization,
              `Bearer ${"a".repeat(64)}`,
            );
            workflowReads++;
            const kathaId = new URL(route.request().url()).pathname.split("/")[3];
            return route.fulfill({
              headers: adminHeaders,
              json: {
                kathaId,
                minted: false,
                published: false,
                steps: {
                  documentation: "COMPLETE",
                  registration: "PENDING",
                  verification: "NOT_STARTED",
                  condition: "NOT_STARTED",
                  custody: "NOT_STARTED",
                  media: "PENDING",
                  minting: "NOT_STARTED",
                  metadata: "NOT_STARTED",
                },
              },
            });
          },
        );
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

      const metadataData = await metadataFixture();
      let metadataPage = {
        ...metadataData.page,
        metadata: metadataData.page.current,
        canSubmit: false,
      };
      let metadataSaves = 0,
        metadataPreparations = 0;
      for (const action of ["metadata", "metadata/documents", "operations/metadata"]) {
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
            if (action === "metadata/documents") {
              const input = route.request().postDataJSON();
              metadataSaves++;
              assert.equal(input.expectedUpdatedAt, metadataPage.updatedAt);
              assert.equal(input.metadataVersionId, metadataPage.metadata.id);
              assert.equal(input.publicApprovalConfirmed, true);
              assert.equal(input.publicContent.story, "Revised public story");
              assert.deepEqual(Object.keys(input).sort(), [
                "expectedUpdatedAt",
                "metadataVersionId",
                "publicApprovalConfirmed",
                "publicContent",
              ]);
              metadataPage = {
                ...metadataData.page,
                updatedAt: "2026-10-07T00:00:00.001Z",
              };
            }
            if (action === "operations/metadata") {
              metadataPreparations++;
              const input = route.request().postDataJSON();
              assert.equal(input.expectedMetadataVersion, 1);
              assert.equal(input.expectedMetadataHash, metadataPage.chain.documentHash);
              assert.equal(input.metadataVersionId, metadataPage.metadata.id);
              return route.fulfill({
                status: 201,
                headers: adminHeaders,
                json: metadataData.operation,
              });
            }
            return route.fulfill({ headers: adminHeaders, json: metadataPage });
          },
        );
      }
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
      // The condition page also lists collector resale inspection requests.
      await context.route(`${apiOrigin}/verifier/artworks/*/resale`, async (route) => {
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
        const kathaId = new URL(route.request().url()).pathname.split("/")[3];
        return route.fulfill({
          headers: adminHeaders,
          json: resaleFixture(walletAddress, kathaId),
        });
      });
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
      await main.getByRole("button", { name: "Connect wallet", exact: true }).click();
      await chooser
        .getByRole("button", { name: "Connect Synthetic test wallet" })
        .click();
      await expect(chooser.getByRole("alert")).toContainText(
        "request wasn't completed",
      );
      await expect(chooser).not.toContainText("PRIVATE_WALLET_ERROR");
      await chooser
        .getByRole("button", { name: "Connect Synthetic test wallet" })
        .click();
      await expect(chooser).toBeHidden();
      await expect(main).toContainText("1111…1111");
      await main.getByRole("button", { name: "Change account", exact: true }).click();
      await chooser.getByRole("button", { name: /^1111…1112/ }).click();
      await expect(chooser).toBeHidden();
      await expect(main).toContainText("1111…1112");
      await expect(main).toContainText("a local Solana network");
      await main
        .getByRole("button", { name: "Sign in with wallet", exact: true })
        .click();
      await expect(alert("Sign-in was not completed")).toBeVisible();
      await expect(main).not.toContainText("PRIVATE_AUTH_ERROR");
      await main
        .getByRole("button", { name: "Sign in with wallet", exact: true })
        .click();
      await expect(main).toContainText("Connected and signed in");
      await expect(main).toContainText(walletAddress);
      await audit("wallet signed in");
      await main
        .getByRole("link", { name: "Continue where you left off", exact: true })
        .click();
      await expect(page).toHaveURL(`${origin}/admin`);
      await expect(main.getByRole("heading", { name: "Create artist" })).toBeVisible();
      await expect(page.locator(".side-foot .who .xs")).toHaveText("Administrator");
      await audit("authorized artist onboarding");
      const createArtist = main.getByRole("button", {
        name: "Create artist",
        exact: true,
      });
      await createArtist.click();
      await expect(main.locator('[name="displayName"]')).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      assert.equal(createCalls, 0);
      await main.locator('[name="displayName"]').fill("Synthetic Nepali artist");
      await main.locator('[name="slug"]').fill("synthetic-nepali-artist");
      await main
        .locator('[name="biography"]')
        .fill("Synthetic cultural documentation from Patan.");
      await main.locator('[name="region"]').fill("Patan");
      await main.getByRole("checkbox", { name: "Paubha", exact: true }).check();
      await main.getByRole("checkbox", { name: "Thangka", exact: true }).check();
      await createArtist.click();
      await expect(alert("slug already exists")).toBeVisible();
      await expect(main).not.toContainText("PRIVATE_ADMIN_SENTINEL");
      await expect(main.locator('[name="displayName"]')).toHaveValue(
        "Synthetic Nepali artist",
      );
      await audit("artist creation conflict");
      await createArtist.click();
      const savedArtistPanel = main.locator('article[aria-labelledby="saved-artist"]');
      await expect(savedArtistPanel).toContainText("Synthetic Nepali artist");
      await expect(savedArtistPanel).toContainText("Not verified");
      assert.equal(createCalls, 2);
      assert.equal(savedArtist.creatorWallet, null);
      assert.equal(savedArtist.payoutWallet, null);
      assert.equal(savedArtist.traditions.join(","), "Paubha,Thangka");
      const approveArtist = main.getByRole("button", {
        name: "Record verification",
        exact: true,
      });
      await expect(approveArtist).toBeDisabled();
      await main
        .getByLabel("Name, slug or record ID", { exact: true })
        .fill(savedArtist.id);
      await main.getByRole("button", { name: "Look up", exact: true }).click();
      await expect(savedArtistPanel).toContainText(savedArtist.id);
      await expect(approveArtist).toBeDisabled();
      await audit("saved artist review");
      await page.evaluate(() => globalThis.scrollTo(0, 0));
      await page.screenshot({
        path: `${artifacts}/admin-review-${width}.png`,
        fullPage: true,
      });
      await savedArtistPanel.getByRole("checkbox").check();
      await approveArtist.click();
      await expect(savedArtistPanel).toContainText("Profile verified");
      await expect(
        savedArtistPanel.getByRole("link", { name: "View public profile" }),
      ).toHaveAttribute("href", "/artists/synthetic-nepali-artist");
      assert.equal(approvalCalls, 1);
      await audit("artist verified");
      await page.evaluate(() => globalThis.scrollTo(0, 0));
      await page.screenshot({
        path: `${artifacts}/admin-${width}.png`,
        fullPage: true,
      });

      await headerLink("/admin/artworks");
      await expect(main.getByRole("heading", { level: 1 })).toHaveText("Artworks");
      const draftPages = main.getByRole("navigation", { name: "Artwork draft pages" });
      await expect(draftPages).toContainText("Showing 1–20");
      await expect(main).toContainText("Not verified");
      await expect(main).toContainText("Lifecycle started");
      await expect(draftPages.getByRole("button", { name: "Previous" })).toBeDisabled();
      await audit("draft list ready");
      await draftPages.getByRole("button", { name: "Next" }).click();
      await expect(draftPages).toContainText("Showing 21–21");
      await expect(main).toContainText("Synthetic second-page draft");
      await expect(draftPages.getByRole("button", { name: "Next" })).toBeDisabled();
      await audit("draft list next page");
      await page.evaluate(() => globalThis.scrollTo(0, 0));
      await page.screenshot({
        path: `${artifacts}/draft-list-${width}.png`,
        fullPage: true,
      });
      await draftPages.getByRole("button", { name: "Previous" }).click();
      await expect(draftPages).toContainText("Showing 1–20");
      await main.getByRole("link", { name: "New artwork", exact: true }).click();
      const createArtwork = main.getByRole("button", { name: "Create artwork" });
      await expect(createArtwork).toBeVisible();
      await audit("draft editor new");
      await createArtwork.click();
      await expect(main.locator('[name="artistId"]')).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      assert.equal(draftCreateCalls, 0);
      await audit("draft editor validation");
      await main.getByRole("radio", { name: "Paubha", exact: true }).check();
      for (const [name, value] of Object.entries({
        artistId: "bbbbbbbb-1111-4111-8111-111111111111",
        creationYear: "2026",
        title: "Synthetic documented Paubha",
        materials: "Silk\nMineral pigment",
        story: "Approved synthetic cultural story",
        heightMm: "300",
        widthMm: "200",
      }))
        await main.locator(`[name="${name}"]`).fill(value);
      const evidenceBytes = Buffer.from("Synthetic private authorship evidence");
      await main
        .getByLabel("Private authorship evidence file", { exact: true })
        .setInputFiles({
          name: "synthetic-evidence.txt",
          mimeType: "text/plain",
          buffer: evidenceBytes,
        });
      await expect(main.locator('[name="authorshipEvidenceHash"]')).toHaveValue(
        await sha256Hex(evidenceBytes),
      );
      await expect(main).toContainText("Fingerprint calculated");
      await createArtwork.click();
      await expect(main).toContainText("Artwork created");
      assert.equal(draftCreateCalls, 1);
      assert.ok(retainedCreationId);
      assert.equal(savedArtwork.category, "PAUBHA");
      await expect(main.locator('[name="artistId"]')).toHaveCount(0);
      await expect(main).toContainText("KATHA-PAUBHA-000050");
      await audit("draft editor created");
      await main.getByRole("link", { name: "Open documentation" }).click();
      await expect(main.getByRole("heading", { level: 1 })).toHaveText(
        "Artwork documentation",
      );
      await expect(main.locator('[name="story"]')).toHaveValue(
        "Approved synthetic cultural story",
      );
      // Tab markers come from the workflow read; the tag panel lists bindings.
      await expect(
        main
          .getByRole("navigation", { name: "Artwork workflows" })
          .getByRole("link", { name: "Documentation, done" }),
      ).toBeVisible();
      await expect(main).toContainText("No tag yet");
      assert.ok(workflowReads > 0);
      assert.ok(nfcListReads > 0);
      await audit("draft editor loaded by permanent ID");
      const workflows = main.getByRole("navigation", { name: "Artwork workflows" });
      // Tab names end with their status (", done", ", in progress", ", not started").
      const tab = (name) =>
        workflows.getByRole("link", { name: new RegExp(`^${name}(,|$)`) }).click();
      const documentation = main.locator("#documentation-form");
      await main.locator('[name="story"]').fill("Revised synthetic cultural story");
      await expect(main).toContainText("You have unsaved changes");
      await documentation.getByRole("button", { name: "Save changes" }).click();
      await expect(alert("Someone may have saved a newer version")).toContainText(
        "draft changed or editing has closed",
      );
      await expect(
        documentation.getByRole("button", { name: "Save changes" }),
      ).toHaveCount(0);
      await expect(main.locator('[name="story"]')).toHaveValue(
        "Revised synthetic cultural story",
      );
      await expect(main).not.toContainText("PRIVATE_SAVE_SENTINEL");
      await audit("draft editor conflict");
      rejectDraftSave = false;
      await main
        .getByRole("button", { name: "Load the saved version to compare" })
        .click();
      const compare = main.locator('section[aria-labelledby="compare-title"]');
      await expect(compare).toContainText("Approved synthetic cultural story");
      await expect(compare.getByRole("radio", { name: /Yours/ })).toBeChecked();
      await expect(main.locator('[name="story"]')).toHaveValue(
        "Revised synthetic cultural story",
      );
      await audit("draft editor compare");
      await documentation.getByRole("button", { name: "Save changes" }).click();
      await expect(main).toContainText("All changes saved");
      await expect(main.locator('[name="story"]')).toHaveValue(
        "Revised synthetic cultural story",
      );
      assert.equal(savedArtwork.story, "Revised synthetic cultural story");
      await audit("draft editor saved");

      await tab("Media");
      await expect(main.getByRole("heading", { level: 1 })).toHaveText(
        "Media management",
      );
      await expect(main).toContainText("No files yet");
      await audit("media empty");
      const upload = main.getByRole("button", { name: "Upload file" });
      await upload.click();
      await expect(main.locator('[name="file"]')).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      assert.equal(mediaWrites, 0);
      await audit("media upload validation");
      for (const caption of [
        "Synthetic front photograph",
        "Synthetic detail photograph",
      ]) {
        await main.locator('[name="file"]').setInputFiles({
          name: "synthetic.png",
          mimeType: "image/png",
          buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
            "base64",
          ),
        });
        await main.locator('[name="caption"]').fill(caption);
        await upload.click();
        await expect(main).toContainText("Media saved.");
        await expect(main.locator('[name="file"]')).toHaveValue("");
      }
      assert.equal(mediaWrites, 2);
      await expect(main).toContainText("Image 2");
      await audit("media private uploads");
      const saveMedia = main.getByRole("button", { name: "Save changes" });
      await main.getByRole("button", { name: "Move Image 2 up" }).click();
      await expect(
        main.getByRole("status").filter({ hasText: "Moved to position" }),
      ).toContainText("position 1");
      await saveMedia.first().click();
      await expect(alert("could not be confirmed")).toBeVisible();
      await expect(main).toContainText("Further changes are paused");
      await expect(saveMedia).toBeDisabled();
      await expect(upload).toBeDisabled();
      await expect(main).not.toContainText("PRIVATE_MEDIA_SENTINEL");
      await audit("media conflict");
      rejectMediaSave = false;
      await main.getByRole("button", { name: "Reload media" }).click();
      await expect(main).not.toContainText("Further changes are paused");
      await expect(upload).toBeEnabled();
      await main.getByRole("button", { name: "Move Image 2 up" }).click();
      const publicId = mediaPage.items[1].id;
      await main.locator(`[name="visibility:${publicId}"][value="PUBLIC"]`).check();
      await saveMedia.first().click();
      await expect(main.locator(`[name="approvedPublic:${publicId}"]`)).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      assert.equal(mediaWrites, 2);
      await main.locator(`[name="approvedPublic:${publicId}"]`).check();
      await main
        .locator(`[name="altText:${publicId}"]`)
        .fill("Approved synthetic photograph of Nepali artwork");
      await saveMedia.first().click();
      await expect(main).toContainText("Public, approved");
      assert.equal(mediaWrites, 3);
      assert.equal(mediaPage.items[0].id, publicId);
      await audit("media approved and reordered");
      mediaPage.editable = false;
      await tab("Documentation");
      await expect(main.locator('[name="story"]')).toHaveValue(
        "Revised synthetic cultural story",
      );
      await tab("Media");
      await expect(main).toContainText("Media is locked.");
      await expect(upload).toBeDisabled();
      await audit("media frozen");
      await page.evaluate(() => globalThis.scrollTo(0, 0));
      await page.screenshot({
        path: `${artifacts}/media-admin-${width}.png`,
        fullPage: true,
      });

      await tab("Registration");
      await expect(main.getByRole("heading", { level: 1 })).toHaveText("Registration");
      const prepareDocument = main.getByRole("button", { name: "Prepare document" });
      await expect(prepareDocument).toBeEnabled();
      await audit("registration without metadata");
      await prepareDocument.click();
      await expect(main).toContainText("Exact saved bytes and fingerprint verified");
      assert.equal(metadataCalls, 1);
      const registrationPrepare = main.getByRole("button", {
        name: "Prepare and simulate registration",
      });
      const registrationConfirm = main.getByRole("checkbox", {
        name: /I reviewed the permanent identity/,
      });
      const reloadRegistration = main.getByRole("button", {
        name: "Reload registration state",
      });
      await expect(registrationPrepare).toBeDisabled();
      await main.getByText("View full document", { exact: true }).click();
      await expect(main.locator("pre")).toContainText(
        "Approved synthetic cultural story",
      );
      await audit("registration canonical review");
      await registrationConfirm.check();
      await registrationPrepare.click();
      await expect(alert("Reload saved state")).toBeVisible();
      await expect(main).not.toContainText("PRIVATE_REGISTRATION_ERROR");
      await audit("registration conflict");
      rejectRegistration = false;
      await reloadRegistration.click();
      await registrationConfirm.check();
      await registrationPrepare.click();
      await expect(main).toContainText("Review transaction before wallet approval");
      assert.equal(registrationCalls, 2);
      assert.equal(registrationSimulations, 1);
      const approve = main.getByRole("button", { name: "Approve in wallet" });
      const cancelReview = main.getByRole("button", { name: "Cancel", exact: true });
      await expect(approve).toBeVisible();
      await audit("registration simulated before approval");
      await cancelReview.click();
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
      await reloadRegistration.click();
      await expect(main).toContainText("A saved signature is unresolved");
      await expect(registrationConfirm).toBeDisabled();
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
      await reloadRegistration.click();
      await expect(main).toContainText("Finalized, indexing pending");
      await audit("registration finalized indexing delay");
      registrationPage.registration.receipt.indexed = true;
      await reloadRegistration.click();
      await expect(main).toContainText("Finalized and indexed");
      await audit("registration indexed");
      await page.evaluate(() => globalThis.scrollTo(0, 0));
      await page.screenshot({
        path: `${artifacts}/registration-admin-${width}.png`,
        fullPage: true,
      });
      // Verifier-only review requires no administrative draft or media access.
      adminAllowed = false;
      verifierAllowed = true;
      await main
        .getByRole("link", { name: "Continue to verification", exact: true })
        .click();
      await expect(main.getByRole("heading", { level: 1 })).toHaveText(
        "Authenticity verification",
      );
      const authenticityPrepare = main.getByRole("button", {
        name: "Prepare verification transaction",
      });
      const reloadVerification = main.getByRole("button", {
        name: "Reload verification state",
      });
      const digest = main.getByLabel(/^Fingerprint of the evidence you reviewed/);
      const confirmVerification = async () => {
        await main
          .getByRole("checkbox", { name: /inspected this physical artwork/ })
          .check();
        await main
          .getByRole("checkbox", { name: /authorship evidence supports attribution/ })
          .check();
      };
      await expect(main.locator(".bdg").first()).toHaveText("Not verified");
      await expect(authenticityPrepare).toBeDisabled();
      await audit("verification manual review");
      await digest.fill("f".repeat(64));
      await confirmVerification();
      await expect(authenticityPrepare).toBeDisabled();
      await expect(main).toContainText("Doesn't match registration");
      await audit("verification evidence mismatch");
      await digest.fill("e".repeat(64));
      await expect(main).toContainText("Matches registration");
      await authenticityPrepare.click();
      await expect(alert("Reload saved state")).toBeVisible();
      await expect(main).not.toContainText("PRIVATE_VERIFICATION_ERROR");
      await audit("verification stale state");
      rejectArtworkVerification = false;
      await reloadVerification.click();
      await digest.fill("e".repeat(64));
      await confirmVerification();
      await authenticityPrepare.click();
      await expect(approve).toBeVisible();
      assert.equal(verificationCalls, 2);
      await audit("verification simulated before approval");
      await cancelReview.click();
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
      await reloadVerification.click();
      await expect(main).toContainText("A verification is waiting to be reconciled");
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
      await reloadVerification.click();
      await expect(main).toContainText("Already verified.");
      await expect(main).toContainText("Finalized, indexing pending");
      await audit("verification finalized indexing pending");
      verificationPage.verification.receipt.indexed = true;
      await reloadVerification.click();
      await expect(main).toContainText("Finalized and indexed");
      await audit("verification indexed");
      await page.screenshot({
        path: `${artifacts}/verification-admin-${width}.png`,
        fullPage: true,
      });
      await main
        .getByRole("link", { name: "Continue to condition", exact: true })
        .click();
      await expect(main.getByRole("heading", { level: 1 })).toHaveText(
        "Condition inspection",
      );
      const prepareReport = main.getByRole("button", {
        name: "Prepare report",
        exact: true,
      });
      const reloadInspection = main.getByRole("button", {
        name: "Reload inspection state",
        exact: true,
      });
      await expect(main).toContainText("Evidence image 1");
      await audit("inspection protected initial scope");
      await prepareReport.click();
      await expect(alert("need attention")).toBeVisible();
      await expect(main).toContainText("Choose a grade.");
      assert.equal(inspectionCalls, 0);
      await main.getByLabel("Add an evidence image", { exact: true }).setInputFiles({
        name: "synthetic.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      });
      await main
        .getByRole("button", { name: "Upload private evidence", exact: true })
        .click();
      await expect(main.getByText("Evidence image 2", { exact: false })).toBeVisible();
      await main.getByRole("radio", { name: "Good", exact: true }).check();
      await main.getByLabel(/^Inspected at/).fill("2026-10-05T10:00");
      await main
        .getByLabel(/^Notes/)
        .fill("Synthetic private browser inspection notes");
      await main.getByRole("checkbox", { name: /Evidence image 2/ }).check();
      await main
        .getByRole("checkbox", { name: /I inspected this work in person/ })
        .check();
      await prepareReport.click();
      await expect(main).toContainText("Prepared, not yet recorded");
      await expect(main).toContainText("Version 2");
      await main.getByText("View private report", { exact: true }).click();
      await expect(main).toContainText("Synthetic private browser inspection notes");
      await audit("inspection private document review");
      const conditionPrepare = main.getByRole("button", {
        name: "Prepare and simulate the report transaction",
        exact: true,
      });
      const conditionApproval = main.getByRole("checkbox", {
        name: /I reviewed the exact saved report/,
      });
      await conditionApproval.check();
      await conditionPrepare.click();
      await expect(alert("changed")).toBeVisible();
      await expect(main).not.toContainText("PRIVATE_INSPECTION_ERROR");
      await audit("inspection stale preparation");
      rejectInspection = false;
      await reloadInspection.click();
      await conditionApproval.check();
      await conditionPrepare.click();
      await expect(
        main.getByRole("heading", {
          name: "Condition report transaction",
          exact: true,
        }),
      ).toBeVisible();
      await expect(approve).toBeEnabled();
      assert.equal(inspectionCalls, 2);
      await audit("inspection simulation before wallet approval");
      await cancelReview.click();
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
      await reloadInspection.click();
      await expect(main).toContainText("A saved report transaction is unresolved");
      await expect(conditionPrepare).toBeDisabled();
      await expect(prepareReport).toBeDisabled();
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
      await reloadInspection.click();
      await expect(main).toContainText("Finalized, indexing pending");
      await audit("inspection finalized indexing pending");
      inspectionPage.attestation.receipt.indexed = true;
      await reloadInspection.click();
      await expect(main).toContainText("Finalized and indexed");
      await audit("inspection indexed");
      await page.screenshot({
        path: `${artifacts}/condition-admin-${width}.png`,
        fullPage: true,
      });
      adminAllowed = true;
      await tab("Custody");
      await expect(main.getByRole("heading", { level: 1 })).toHaveText(
        "Custody and fulfillment",
      );
      await expect(
        main.locator('section[aria-labelledby="custody-current"]'),
      ).toContainText("Held by Katha");
      await audit("custody administration");
      await tab("Minting");
      await expect(main.getByRole("heading", { level: 1 })).toHaveText(
        "Minting and publication",
      );
      await audit("Core mint review");
      const prepareMint = main.getByRole("button", {
        name: "Review and approve mint",
        exact: true,
      });
      const reloadSaved = main.getByRole("button", {
        name: "Reload saved state",
        exact: true,
      });
      await expect(prepareMint).toBeDisabled();
      await main
        .getByRole("checkbox", { name: /I reviewed the public metadata/ })
        .check();
      await prepareMint.click();
      await expect(main).toContainText("Review transaction before wallet approval");
      assert.equal(mintPreparations, 1);
      assert.equal(publications, 0);
      await audit("mint simulation requires separate wallet approval");
      await cancelReview.click();
      mintPage.canMint = false;
      mintPage.chain.minted = true;
      mintPage.chain.owner = mintFixtureData.operation.feePayer;
      mintPage.blockedReasons = ["INDEXING_PENDING"];
      await reloadSaved.click();
      const publishArtwork = main.getByRole("button", {
        name: "Publish artwork",
        exact: true,
      });
      await expect(main).toContainText("Publication opens once");
      await expect(publishArtwork).toHaveCount(0);
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
      await reloadSaved.click();
      await publishArtwork.click();
      const publishDialog = main.getByRole("alertdialog");
      await expect(
        publishDialog.getByRole("button", { name: "Publish artwork" }),
      ).toBeDisabled();
      await publishDialog
        .getByRole("checkbox", { name: /I reviewed the finalized asset/ })
        .check();
      await publishDialog.getByRole("button", { name: "Publish artwork" }).click();
      await expect(alert("Reload saved state")).toBeVisible();
      assert.equal(publications, 1);
      await audit("publication conflict requires reload");
      rejectPublication = false;
      await reloadSaved.click();
      if (!(await publishDialog.isVisible())) await publishArtwork.click();
      await publishDialog
        .getByRole("checkbox", { name: /I reviewed the finalized asset/ })
        .check();
      await publishDialog.getByRole("button", { name: "Publish artwork" }).click();
      await expect(
        main.getByRole("link", { name: "View public record", exact: true }),
      ).toHaveAttribute("href", `/art/${mintPage.kathaId}`);
      assert.equal(publications, 2);
      await audit("explicit verified publication");
      await page.screenshot({
        path: `${artifacts}/mint-admin-${width}.png`,
        fullPage: true,
      });

      await tab("Metadata");
      await expect(main.getByRole("heading", { level: 1 })).toHaveText(
        "Metadata revisions",
      );
      await expect(main).toContainText(metadataPage.chain.documentHash);
      await audit("metadata current commitment review");
      await main.locator("#metadata-story").fill("Revised public story");
      await main.getByRole("button", { name: "Compare with current version" }).click();
      await expect(main.locator("ins").first()).toBeVisible();
      const revisionSave = main.getByRole("button", {
        name: "Save immutable revision",
        exact: true,
      });
      await expect(revisionSave).toBeDisabled();
      await audit("metadata word comparison");
      await main
        .getByRole("checkbox", { name: /I approve this text for public display/ })
        .check();
      await revisionSave.click();
      await expect(main).toContainText(metadataData.page.metadata.documentHash);
      assert.equal(metadataSaves, 1);
      const prepareRevision = main.getByRole("button", {
        name: "Prepare metadata revision",
        exact: true,
      });
      await expect(prepareRevision).toBeDisabled();
      await main
        .getByRole("checkbox", { name: /I reviewed the saved document/ })
        .check();
      await prepareRevision.click();
      await expect(approve).toBeVisible();
      assert.equal(metadataPreparations, 1);
      await audit("atomic metadata revision separate wallet approval");
      await cancelReview.click();
      metadataPage = {
        ...metadataPage,
        metadata: { ...metadataPage.metadata, status: "FINALIZED" },
        current: { ...metadataPage.metadata, status: "FINALIZED" },
        chain: {
          ...metadataPage.chain,
          version: 2,
          documentHash: metadataPage.metadata.documentHash,
          uri: metadataPage.metadata.uri,
        },
        canSubmit: false,
        revision: {
          finalized: true,
          unresolved: false,
          receipt: {
            status: "FINALIZED",
            signature: "1".repeat(88),
            slot: "2",
            indexed: true,
          },
        },
      };
      await reloadSaved.click();
      await expect(main).toContainText("Finalized and indexed");
      await expect(
        main.getByRole("button", {
          name: "Prepare metadata revision",
          disabled: false,
        }),
      ).toHaveCount(0);
      await audit("metadata finalized version retained history");
      await page.screenshot({
        path: `${artifacts}/metadata-admin-${width}.png`,
        fullPage: true,
      });
      adminAllowed = false;
      await reloadSaved.click();
      await expect(alert("administrator session")).toBeVisible();
      await expect(main).not.toContainText(metadataPage.metadata.canonicalDocument);
      await audit("metadata role revocation clears private review");
      adminAllowed = true;
      await tab("Minting");
      await expect(main).toContainText("Published");
      adminAllowed = false;
      await reloadSaved.click();
      await expect(alert("administrator session")).toBeVisible();
      await expect(main).not.toContainText(mintPage.metadata.canonicalDocument);
      await audit("mint permission revoked clears review");
      adminAllowed = true;
      await tab("Custody");
      const request = main.locator(
        `section[aria-labelledby="request-${custodyPage.requests[0].request.id}"]`,
      );
      const reloadCustody = main.getByRole("button", {
        name: "Reload custody state",
        exact: true,
      });
      await expect(request).toContainText("Delivery request");
      await expect(request).toContainText("synthetic@example.invalid");
      const approveRequest = request.getByRole("button", {
        name: "Approve request",
        exact: true,
      });
      const confirmRequest = () =>
        request
          .getByRole("checkbox", { name: /I confirmed this update manually/ })
          .check();
      await expect(approveRequest).toBeDisabled();
      await confirmRequest();
      await approveRequest.click();
      await expect(alert("Reload saved state")).toBeVisible();
      await expect(approveRequest).toBeDisabled();
      await audit("fulfillment conflict");
      rejectFulfillment = false;
      await reloadCustody.click();
      await confirmRequest();
      await approveRequest.click();
      await expect.poll(() => fulfillmentWrites).toBe(2);
      await expect(request.getByLabel(/^Courier/)).toBeVisible();
      await expect(request.locator(".flow")).toContainText("Approved, current");
      await expect(
        main.locator('section[aria-labelledby="custody-current"]'),
      ).toContainText("Held by Katha");
      assert.equal(custodyPreparations, 0);
      await audit("fulfillment approval separate from custody");
      await main
        .getByLabel("Related fulfillment request", { exact: true })
        .selectOption(custodyPage.requests[0].request.id);
      await main
        .getByLabel("Physical movement", { exact: true })
        .selectOption("DISPATCH_FROM_KATHA");
      const custodyPrepare = main.getByRole("button", {
        name: "Review custody change",
        exact: true,
      });
      await expect(custodyPrepare).toBeDisabled();
      await main
        .getByRole("checkbox", { name: /this physical movement has already happened/ })
        .check();
      await custodyPrepare.click();
      await expect(main).toContainText("Review transaction before wallet approval");
      assert.equal(custodyPreparations, 1);
      await audit("custody transaction review");
      await page.screenshot({
        path: `${artifacts}/custody-admin-${width}.png`,
        fullPage: true,
      });
      await cancelReview.click();
      custodyPage.custody.unresolved = true;
      await reloadCustody.click();
      await expect(main).toContainText("A signed custody transaction is unresolved");
      await expect(custodyPrepare).toBeDisabled();
      await audit("custody unresolved signature");
      custodyPage.custody.unresolved = false;
      custodyPage.canAttest = false;
      await reloadCustody.click();
      await expect(main).toContainText("custody authority signs custody records");
      await expect(custodyPrepare).toBeDisabled();
      await audit("custody administrator without chain authority");
      adminAllowed = false;
      await reloadCustody.click();
      await expect(alert("administrator session")).toBeVisible();
      await expect(main).not.toContainText("synthetic@example.invalid");
      await expect(main).not.toContainText("Synthetic address");
      await audit("custody role revoked clears private details");
      await tab("Condition");
      await expect(main).toContainText("Finalized and indexed");
      verifierAllowed = false;
      await reloadInspection.click();
      await expect(main).not.toContainText(
        "Synthetic private browser inspection notes",
      );
      await expect(alert("A verifier session")).toBeVisible();
      await audit("inspection permission revoked");
      verifierAllowed = true;
      await tab("Verification");
      await expect(main).toContainText("Already verified.");
      verifierAllowed = false;
      await reloadVerification.click();
      await expect(alert("A verifier session")).toBeVisible();
      await expect(main).not.toContainText("Synthetic Nepali artwork");
      await audit("verification authority revoked");
      adminAllowed = true;
      verifierAllowed = true;
      freezeDraft = true;
      await tab("Documentation");
      await expect(main).toContainText("Documentation is locked.");
      await expect(main).toContainText("Locked after lifecycle records exist");
      await expect(main.getByRole("button", { name: "Save changes" })).toHaveCount(0);
      await audit("draft editor frozen");
      await page.evaluate(() => globalThis.scrollTo(0, 0));
      await page.screenshot({
        path: `${artifacts}/draft-editor-${width}.png`,
        fullPage: true,
      });
      await headerLink("/admin/artworks");
      await expect(draftPages).toContainText("Showing 1–20");
      draftMode = "UNAVAILABLE";
      await headerLink("/admin");
      await headerLink("/admin/artworks");
      await expect(alert("Artwork records couldn't load")).toBeVisible();
      await expect(main).not.toContainText("Synthetic unpublished work");
      await expect(main).not.toContainText("PRIVATE_DRAFT_SENTINEL");
      await audit("draft list unavailable");
      draftMode = "EMPTY";
      await main.getByRole("button", { name: "Try again" }).click();
      await expect(main).toContainText("No artworks yet");
      await audit("draft list empty");
      draftMode = "DENIED";
      await headerLink("/admin");
      await headerLink("/admin/artworks");
      await expect(main).toContainText("This workspace needs an administrator role");
      await audit("draft list permission revoked");
      await headerLink("/admin");
      await expect(main.getByRole("heading", { name: "Create artist" })).toBeVisible();
      await headerLink("/account");
      await main.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(
        main.getByRole("heading", { name: "Prove this wallet is yours", exact: true }),
      ).toBeVisible();
      await expect.poll(() => logoutCalls).toBe(1);
      await page.goBack();
      await expect(page).toHaveURL(`${origin}/admin`);
      await expect(main).toContainText("Sign in to use operations");
      await expect(main).not.toContainText("Synthetic Nepali artist");
      await audit("admin signed out");
      adminAllowed = false;
      verifierAllowed = false;

      await main.getByRole("link", { name: "Sign in", exact: true }).click();
      await main
        .getByRole("button", { name: "Sign in with wallet", exact: true })
        .click();
      await expect(main).toContainText("Connected and signed in");
      await main
        .getByRole("link", { name: "Continue where you left off", exact: true })
        .click();
      await expect(main).toContainText("You don't have access to operations");
      await expect(page.locator(".side-foot .who .xs")).toHaveText(
        "No operations role",
      );
      await audit("admin permission denied");
      await main.getByRole("link", { name: "Switch wallet", exact: true }).click();
      await main.getByRole("button", { name: "Change account", exact: true }).click();
      await chooser.getByRole("button", { name: /^1111…1111/ }).click();
      await expect(main).toContainText("Your wallet switched accounts.");
      await expect(
        main.getByRole("heading", { name: "Prove this wallet is yours", exact: true }),
      ).toBeVisible();
      await expect(
        main.getByRole("button", { name: "Sign in as 1111…1111", exact: true }),
      ).toBeVisible();
      await expect.poll(() => logoutCalls).toBe(2);
      assert.equal(verifyCalls, 3);
      await audit("wallet connected");
      await main
        .locator('section[aria-labelledby="account-wallet-title"]')
        .screenshot({ path: `${artifacts}/wallet-${width}.png` });
      await main.getByRole("button", { name: "Disconnect", exact: true }).click();
      await main.getByRole("button", { name: "Connect wallet", exact: true }).click();
      await expect(
        chooser.getByRole("button", { name: "Connect Synthetic test wallet" }),
      ).toBeVisible();
      await page.evaluate(() => globalThis.__kathaWalletTest.unregister());
      await expect(chooser).toContainText("No compatible Solana wallet found");
      await chooser.getByRole("button", { name: "Close", exact: true }).click();
      assert.equal(
        await page.evaluate(() => globalThis.__kathaWalletTest.signCalls()),
        3,
      );
      assert.equal(
        await page.evaluate(() => globalThis.__kathaWalletTest.transactionCalls()),
        0,
      );
      // Restart keyboard traversal from a fresh document after wallet controls.
      await page.goto(origin);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        "RWAs on Solana.",
      );
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
      await expect(main).toBeFocused();

      for (const [href, id] of [
        ["/#own", "own"],
        ["/#how", "how"],
      ]) {
        await headerLink(href);
        await expect(page).toHaveURL(new RegExp(`#${id}$`));
        await expect(page.locator(`#${id}`)).toBeFocused();
      }
      // The reference header stays in document flow; the reader can return
      // to the top without losing keyboard focus or the selected theme.
      const header = page.locator(".hdr");
      const toTop = page.getByRole("button", { name: "Back to top", exact: true });
      await expect(toTop).toBeVisible();
      assert.ok((await toTop.boundingBox()).height >= 44);
      await audit("home scrolled");
      await toTop.click();
      await expect.poll(() => page.evaluate(() => globalThis.scrollY)).toBe(0);
      await expect(header).toBeInViewport();
      await expect(main).toBeFocused();
      await expect(toTop).toBeHidden();
      const explore = main
        .getByRole("link", { name: "Explore artworks", exact: true })
        .first();
      assert.ok((await explore.boundingBox()).height >= 44);
      await explore.click();
      await expect(page).toHaveURL(`${origin}/explore`);
      await audit("catalogue");
      await page
        .getByRole("navigation", { name: "Filter by tradition" })
        .getByRole("link", { name: "Paubha", exact: true })
        .click();
      await expect(page).toHaveURL(`${origin}/explore?category=PAUBHA`);
      await expect(
        page
          .getByRole("navigation", { name: "Filter by tradition" })
          .getByRole("link", { name: "Paubha", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await page.locator('main a[href="/art/KATHA-PAUBHA-000001"]').first().click();
      await expect(page).toHaveURL(`${origin}/art/KATHA-PAUBHA-000001`);
      await expect(page.locator("#artwork-title")).toBeVisible();
      const identity = page.locator("#identify");
      await expect(
        identity.getByRole("heading", { name: "Identifying this painting" }),
      ).toBeVisible();
      await expect(identity).toContainText("A basic tag can be copied");
      await expect(identity).toContainText("KATHA-PAUBHA-000001");
      await identity.getByRole("link", { name: "evidence below", exact: true }).click();
      await expect(page).toHaveURL(`${origin}/art/KATHA-PAUBHA-000001#evidence`);
      await expect(page.locator("#evidence")).toBeInViewport();
      for (const id of ["ev-verification", "ev-condition", "ev-custody", "ev-chain"]) {
        await page.locator(`a.srow[href="#${id}"]`).click();
        await expect(page).toHaveURL(`${origin}/art/KATHA-PAUBHA-000001#${id}`);
        await expect(page.locator(`#${id}`)).toBeVisible();
        await expect(page.locator(`#${id}`)).toBeInViewport();
        await expect(page.locator(`#${id}-tab`)).toHaveAttribute(
          "aria-selected",
          "true",
        );
      }
      await page.getByRole("tab", { name: "History", exact: true }).click();
      await expect(page.locator("#provenance")).toContainText("Primary sale");
      await expect(page.locator("#provenance")).toContainText("Secondary sale");
      await expect(
        page.getByRole("img", {
          name: "Approved synthetic resale inspection photograph",
        }),
      ).toBeVisible();
      await page
        .locator("#provenance")
        .screenshot({ path: `${artifacts}/history-${width}.png` });
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
      await headerLink("/#own");
      await expect(page).toHaveURL(`${origin}/#own`);
      await expect(page.locator("#own")).toBeFocused();
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
          .locator(".btn")
          .first()
          .evaluate((element) =>
            globalThis
              .getComputedStyle(element)
              .transitionDuration.split(",")
              .every((value) => value.trim() === "0s"),
          ),
      );
      for (const [category, message] of [
        ["THANGKA", "No Thangka works yet"],
        ["MANDALA", "Artworks couldn't load"],
      ]) {
        await page.goto(`${origin}/explore?category=${category}`);
        // The existing empty catalogue describes the currently matched query.
        await expect(main).toContainText(message);
        await audit(`catalogue ${category}`);
      }

      await page.goto(`${origin}/art/KATHA-PAUBHA-999999`);
      await expect(
        page.getByRole("heading", { name: "Nothing is recorded here" }),
      ).toBeVisible();
      await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
        "content",
        /noindex/,
      );
      await audit("unknown artwork");
      await page.getByRole("link", { name: "Go to the home page" }).click();
      await expect(page.locator("#hero-title")).toBeVisible();

      setArtworkOutage(true);
      await page.goto(`${origin}/art/KATHA-PAUBHA-000001`);
      await expect(
        page.getByRole("heading", { name: "Katha is temporarily unavailable" }),
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
      await revealHeader();
      await page.getByRole("banner").getByRole("link", { name: "Katha home" }).click();
      await expect(page.locator("#hero-title")).toBeVisible();

      for (const [mode, message] of [
        ["EMPTY", "The first works are being documented"],
        ["UNAVAILABLE", "The catalogue couldn't load"],
      ]) {
        setHomeMode(mode);
        await page.goto(origin);
        await expect(main.getByText(message, { exact: false })).toBeVisible();
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
        await main.evaluate((element, html) => {
          let target = element.querySelector("#synthetic-transaction-review");
          if (!target) {
            target = globalThis.document.createElement("div");
            target.id = "synthetic-transaction-review";
            element.append(target);
          }
          target.innerHTML = `<section class="wrap"><h2>Wallet operations</h2>${html}</section>`;
        }, renderTransactionReviewPhase(phase));
        const panel = page.locator("#synthetic-transaction-review");
        await expect(
          panel.getByRole("heading", { name: "Transaction", exact: true }),
        ).toBeVisible();
        const approveReview = panel.getByRole("button", { name: "Approve in wallet" });
        await expect(approveReview).toHaveCount(phase === "review" ? 1 : 0);
        if (phase === "review") {
          await approveReview.focus();
          await expect(approveReview).toBeFocused();
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
