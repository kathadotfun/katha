import { resaleFixture } from "../apps/web/tests/fixtures/resale.ts";
import { purchaseFixture } from "../apps/web/tests/fixtures/purchase.ts";
import { purchaseQuoteFixture } from "../apps/web/tests/fixtures/purchase-quote.ts";
import {
  listingFixture,
  cancellationFixture,
} from "../apps/web/tests/fixtures/listing.ts";
import { provenanceFixture } from "../apps/web/tests/fixtures/provenance.ts";
import {
  collectionFixture,
  collectionListingFixture,
} from "../apps/web/tests/fixtures/collection.ts";
/* global document, innerWidth, window */
import console from "node:console";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { URL } from "node:url";
import { walletSignInMessage } from "../packages/shared/dist/index.js";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
export async function runCollectorAccountJourney({ origin, apiOrigin }) {
  const browser = await chromium.launch();
  try {
    for (const width of [375, 768, 1280]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const fixture = await listingFixture({ kathaId: "KATHA-PAUBHA-000001" });
      let issuedSession;
      let mode = "EMPTY";
      let accountCalls = 0;
      let collectionMode = "READY";
      let listingUnavailable = false;
      let listingActive = false;
      const headers = {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "content-type,authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Cache-Control": "no-store",
      };
      await context.route("**/*", (route) =>
        [origin, apiOrigin].includes(new URL(route.request().url()).origin)
          ? route.continue()
          : route.abort(),
      );
      let resaleMode = "KATHA_HELD",
        resaleRequests = [],
        resaleWrites = 0;
      await context.route(`${apiOrigin}/resale/artworks/*`, async (route) => {
        const id = new URL(route.request().url()).pathname.split("/").at(-1);
        if (route.request().method() === "POST") {
          const input = route.request().postDataJSON();
          assert.equal(input.inspectionRequested, true);
          assert.equal(input.expectedCustodyRevision, "2");
          resaleWrites++;
          resaleRequests = [
            {
              id: input.requestId,
              ownerWallet: issuedSession.walletAddress,
              custodyRevision: "2",
              conditionVersion: 1,
              requestedAt: new Date().toISOString(),
            },
          ];
        }
        const value = resaleFixture(issuedSession.walletAddress, id);
        if (resaleMode !== "KATHA_HELD") {
          value.custodyState = "COLLECTOR_HELD";
          value.custodyRevision = "2";
          value.requests = resaleRequests;
          value.inspection.status =
            resaleMode === "APPROVED"
              ? "APPROVED"
              : resaleMode === "EXPIRED"
                ? "EXPIRED"
                : "REQUIRED";
          value.inspection.validUntil = "1792000000";
          value.canList = resaleMode === "APPROVED";
          value.canRequest = resaleMode !== "APPROVED" && !resaleRequests.length;
        }
        return route.fulfill({ headers, json: value });
      });
      await context.route(`${apiOrigin}/account`, async (route) => {
        if (route.request().method() === "OPTIONS")
          return route.fulfill({ status: 204, headers });
        accountCalls++;
        assert.equal(
          route.request().headers().authorization,
          `Bearer ${"a".repeat(64)}`,
        );
        if (mode === "FAIL")
          return route.fulfill({
            status: 503,
            headers,
            json: { privateError: "PRIVATE ACCOUNT ERROR" },
          });
        if (mode === "REVOKED") return route.fulfill({ status: 401, headers });
        return route.fulfill({
          headers,
          json: {
            session: issuedSession,
            indexedArtworkCount: mode === "EMPTY" ? 0 : 2,
            evaluatedAt: new Date().toISOString(),
          },
        });
      });
      await context.route(`${apiOrigin}/account/collection?**`, async (route) => {
        if (route.request().method() === "OPTIONS")
          return route.fulfill({ status: 204, headers });
        assert.equal(
          route.request().headers().authorization,
          `Bearer ${"a".repeat(64)}`,
        );
        if (collectionMode === "FAIL") return route.fulfill({ status: 503, headers });
        const offset = Number(
          new URL(route.request().url()).searchParams.get("offset"),
        );
        const value = collectionFixture(issuedSession.walletAddress, offset);
        if (value.items[0])
          value.items[0].assetAddress = fixture.expected.listing.asset;
        if (collectionMode === "EMPTY") value.items = [];
        if (collectionMode === "COLLECTOR" && value.items[0])
          value.items[0].custody.state = "COLLECTOR_HELD";
        return route.fulfill({ headers, json: value });
      });
      await context.route(`${apiOrigin}/artworks/*/listing`, async (route) => {
        assert.equal(route.request().headers().authorization, undefined);
        if (listingUnavailable) return route.fulfill({ status: 503, headers });
        return route.fulfill({
          headers,
          json: {
            ...collectionListingFixture(issuedSession.walletAddress),
            asset: fixture.expected.listing.asset,
            listing: listingActive
              ? {
                  address: "11111111111111111111111111111113",
                  status: "ACTIVE",
                  revision: "1",
                  completedSales: "0",
                  saleKind: "PRIMARY",
                  seller: issuedSession.walletAddress,
                  paymentMint: "11111111111111111111111111111114",
                  decimals: 6,
                  price: "1000000",
                  createdAt: "1700000000",
                  expiresAt: "1900000000",
                  active: true,
                }
              : null,
          },
        });
      });
      await context.route(`${apiOrigin}/auth/**`, async (route) => {
        if (route.request().method() === "OPTIONS")
          return route.fulfill({ status: 204, headers });
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("logout")) return route.fulfill({ status: 204, headers });
        const input = route.request().postDataJSON();
        if (path.endsWith("challenge")) {
          const challengeId = "aaaaaaaa-1111-4111-8111-111111111111",
            expiresAt = new Date(Date.now() + 60_000).toISOString();
          return route.fulfill({
            headers,
            json: {
              challengeId,
              expiresAt,
              message: walletSignInMessage({
                origin,
                walletAddress: input.walletAddress,
                cluster: "localnet",
                nonce: "a".repeat(64),
                issuedAt: new Date().toISOString(),
                expiresAt,
                challengeId,
              }),
            },
          });
        }
        issuedSession = {
          walletId: "bbbbbbbb-1111-4111-8111-111111111111",
          walletAddress: input.walletAddress,
          cluster: "localnet",
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        };
        return route.fulfill({
          headers,
          json: { token: "a".repeat(64), session: issuedSession },
        });
      });
      await page.goto(`${origin}/account`);
      const main = page.getByRole("main");
      await expect(
        main.getByRole("heading", { name: "A place for your collecting journey." }),
      ).toBeVisible();
      assert.equal(accountCalls, 0);
      await expect(main).toContainText("Test-token payments");
      await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
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
        let reject = false;
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
      const walletPanel = page.locator("#wallet-connection-panel");
      await walletPanel
        .getByRole("button", { name: "Connect Synthetic test wallet" })
        .click();
      await walletPanel
        .getByLabel("Wallet account")
        .selectOption("11111111111111111111111111111112");
      await main.getByRole("button", { name: "Sign in to Katha", exact: true }).click();
      await expect(main).toContainText("No published artworks are indexed");
      mode = "READY";
      await main.getByRole("button", { name: "Refresh account" }).click();
      await expect(main).toContainText("This count reflects");
      assert.equal(
        (await main
          .getByRole("button", { name: "Refresh account" })
          .evaluate((element) => element.getBoundingClientRect().height)) >= 40,
        true,
      );
      await page.getByRole("button", { name: "Wallet connected", exact: true }).click();
      const audit = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(audit.violations, []);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.evaluate(() => document.activeElement?.blur());
      await page.screenshot({
        path: `/tmp/katha-121-account-${width}.png`,
        fullPage: true,
      });
      await main.getByRole("link", { name: "View my collection", exact: true }).click();
      await expect(main).toContainText("Your collection, with its stories intact.");
      await expect(main).toContainText("In Katha custody");
      await expect(main).toContainText("Indexing is catching up");
      await expect(main).toContainText("No listing recorded");
      listingActive = true;
      await main
        .getByRole("button", { name: "Refresh collection", exact: true })
        .click();
      await expect(main).toContainText("Active listing");
      await expect(main).toContainText("In Katha custody");
      const collectionAudit = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(collectionAudit.violations, []);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.evaluate(() => document.activeElement?.blur());
      await page.screenshot({
        path: `/tmp/katha-122-collection-${width}.png`,
        fullPage: true,
      });
      await main.getByRole("button", { name: "Next page", exact: true }).click();
      await expect(main).toContainText("No artworks on this page");
      await main.getByRole("button", { name: "Previous page", exact: true }).click();
      await expect(main).toContainText("In Katha custody");
      // Private shipping and owner receipt are independent of wallet signing and custody.
      let deliveryRequests = [],
        deliveryFail = false,
        deliveryWrites = 0;
      const deliveryId = collectionFixture(issuedSession.walletAddress).items[0].artwork
        .kathaId;
      await context.route(
        `${apiOrigin}/fulfillment/artworks/${deliveryId}**`,
        async (route) => {
          assert.equal(
            route.request().headers().authorization,
            `Bearer ${"a".repeat(64)}`,
          );
          if (deliveryFail) return route.fulfill({ status: 503, headers });
          if (route.request().method() === "POST") {
            deliveryWrites++;
            const input = route.request().postDataJSON();
            const now = new Date().toISOString();
            const { requestId, ...fields } = input;
            const row = {
              ...fields,
              id: requestId,
              kathaId: deliveryId,
              status: "REQUESTED",
              courier: null,
              trackingReference: null,
              ownerReportedReceivedAt: null,
              createdAt: now,
              updatedAt: now,
            };
            deliveryRequests = [row];
            return route.fulfill({ headers, json: row });
          }
          return route.fulfill({
            headers,
            json: {
              kathaId: deliveryId,
              title: "Synthetic delivery artwork",
              cluster: "localnet",
              ownerWallet: issuedSession.walletAddress,
              custodyState: deliveryRequests.length ? "IN_TRANSIT" : "KATHA_HELD",
              custodyRevision: "1",
              canRequest: !deliveryRequests.length,
              requests: deliveryRequests,
              pagination: { limit: 20, offset: 0, hasMore: false },
            },
          });
        },
      );
      await context.route(`${apiOrigin}/fulfillment/*/receipt`, async (route) => {
        assert.equal(route.request().postDataJSON().receiptConfirmed, true);
        deliveryRequests = [
          { ...deliveryRequests[0], ownerReportedReceivedAt: new Date().toISOString() },
        ];
        return route.fulfill({ headers, json: deliveryRequests[0] });
      });
      await main
        .getByRole("link", { name: "Delivery and receipt", exact: true })
        .click();
      await expect(
        main.getByRole("heading", { name: "Bring the artwork home." }),
      ).toBeVisible();
      await main.getByRole("button", { name: "Refresh delivery requests" }).click();
      await main
        .getByLabel("Recipient name", { exact: true })
        .fill("Synthetic recipient");
      await main.getByLabel("Address lines", { exact: true }).fill("Synthetic address");
      await main.getByLabel("City", { exact: true }).fill("Synthetic city");
      await main.getByRole("button", { name: "Send private delivery request" }).click();
      await expect(main.getByRole("alert")).toContainText("provide an email or phone");
      assert.equal(deliveryWrites, 0);
      await main
        .getByLabel("Contact email", { exact: true })
        .fill("synthetic@example.invalid");
      await page.evaluate(() => {
        document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: `/tmp/katha-127-delivery-${width}.png`,
        fullPage: true,
      });
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await main.getByRole("button", { name: "Send private delivery request" }).click();
      await expect(main).toContainText("Delivery · Requested");
      assert.equal(deliveryWrites, 1);
      deliveryRequests = [{ ...deliveryRequests[0], status: "DISPATCHED" }];
      await main.getByRole("button", { name: "Refresh delivery requests" }).click();
      await expect(
        main.getByRole("button", { name: "Report physical receipt" }),
      ).toBeDisabled();
      await main.getByLabel("I physically received this artwork.").check();
      await main.getByRole("button", { name: "Report physical receipt" }).click();
      await expect(main).toContainText("You reported receipt");
      await expect(main).toContainText("Delivery · Dispatched");
      await expect(main).toContainText("Finalized custody: In transit");
      deliveryFail = true;
      await main.getByRole("button", { name: "Refresh delivery requests" }).click();
      await expect(main.getByRole("alert")).toContainText("could not be confirmed");
      await expect(main).not.toContainText("Synthetic address");
      await main.getByRole("link", { name: "Back to my collection" }).click();
      await main
        .getByRole("button", { name: "Refresh collection", exact: true })
        .click();
      resaleMode = "REQUIRED";
      await main
        .getByRole("link", { name: "Inspection and resale", exact: true })
        .click();
      await expect(
        main.getByRole("heading", { name: "Preserve the story through resale." }),
      ).toBeVisible();
      await main.getByRole("button", { name: "Refresh inspection status" }).click();
      await expect(main).toContainText("Inspection approval: required");
      await expect(
        main.getByRole("link", { name: "Review a listing", exact: true }),
      ).toHaveCount(0);
      await main
        .getByRole("button", { name: "Request Katha resale inspection" })
        .click();
      await expect(main).toContainText(
        "Manual inspection or renewed approval is required",
      );
      assert.equal(resaleWrites, 1);
      assert.equal(
        await page.evaluate(() => globalThis.__kathaWalletTest.transactionCalls()),
        0,
      );
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.evaluate(() => {
        document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: `/tmp/katha-128-resale-${width}.png`,
        fullPage: true,
      });
      resaleMode = "APPROVED";
      await main.getByRole("button", { name: "Refresh inspection status" }).click();
      await expect(main).toContainText(
        "Matching finalized inspection approval observed",
      );
      await expect(
        main.getByRole("link", { name: "Review a listing", exact: true }),
      ).toBeVisible();
      resaleMode = "EXPIRED";
      await main.getByRole("button", { name: "Refresh inspection status" }).click();
      await expect(main).toContainText("Inspection approval: expired");
      await expect(
        main.getByRole("link", { name: "Review a listing", exact: true }),
      ).toHaveCount(0);
      resaleMode = "KATHA_HELD";
      await main.getByRole("link", { name: "Back to my collection" }).click();
      await main
        .getByRole("button", { name: "Refresh collection", exact: true })
        .click();
      collectionMode = "COLLECTOR";
      listingUnavailable = true;
      await main
        .getByRole("button", { name: "Refresh collection", exact: true })
        .click();
      await expect(main).toContainText("Collector-held");
      await expect(main).toContainText("Listing status unavailable");
      collectionMode = "FAIL";
      await main
        .getByRole("button", { name: "Refresh collection", exact: true })
        .click();
      await expect(main.getByRole("alert")).toContainText("could not be loaded");
      await expect(main).not.toContainText("Collector-held");
      collectionMode = "EMPTY";
      await main.getByRole("button", { name: "Try again", exact: true }).click();
      await expect(main).toContainText(
        "No published artworks are indexed to this wallet yet",
      );
      // Exercise the owner form with a generated instruction, isolated API and RPC.

      let listingPreparations = 0;
      let releaseMode = "NONE",
        releasePreparations = 0;
      const releaseFixture = await cancellationFixture({
        kathaId: fixture.operation.kathaId,
      });
      await context.route(
        `${apiOrigin}/artworks/${fixture.operation.kathaId}/listing`,
        (route) =>
          route.fulfill({
            headers,
            json: {
              ...collectionListingFixture(issuedSession.walletAddress),
              kathaId: fixture.operation.kathaId,
              asset: fixture.expected.listing.asset,
              currentRevision:
                releaseMode === "NONE" ? "0" : releaseMode === "CANCELLED" ? "2" : "1",
              chainTime:
                releaseMode === "EXPIRED"
                  ? "1900000000"
                  : String(Math.floor(Date.now() / 1000)),
              listing:
                releaseMode === "NONE"
                  ? null
                  : {
                      address: releaseFixture.listingAddress,
                      status: releaseMode === "CANCELLED" ? "CANCELLED" : "ACTIVE",
                      revision: releaseMode === "CANCELLED" ? "2" : "1",
                      completedSales: "0",
                      saleKind: "PRIMARY",
                      seller: issuedSession.walletAddress,
                      paymentMint: "11111111111111111111111111111114",
                      decimals: 6,
                      price: "12500001",
                      createdAt: "1700000000",
                      expiresAt: "1900000000",
                      active: releaseMode === "ACTIVE",
                    },
            },
          }),
      );
      await context.route(
        `${apiOrigin}/artworks/${fixture.operation.kathaId}/provenance?**`,
        (route) =>
          route.fulfill({
            headers,
            json: {
              ...provenanceFixture,
              kathaId: fixture.operation.kathaId,
              chain: {
                ...provenanceFixture.chain,
                coreAssetAddress: fixture.expected.listing.asset,
                collectionAddress: fixture.expected.listing.collection,
              },
            },
          }),
      );
      await context.route(
        `${apiOrigin}/artworks/${fixture.operation.kathaId}/operations/listing`,
        async (route) => {
          if (route.request().method() === "OPTIONS")
            return route.fulfill({ status: 204, headers });
          assert.equal(
            route.request().headers().authorization,
            `Bearer ${"a".repeat(64)}`,
          );
          const input = route.request().postDataJSON();
          assert.equal(input.price, "12500001");
          assert.equal(input.expectedRevision, "0");
          listingPreparations++;
          const prepared = await listingFixture({
            kathaId: fixture.operation.kathaId,
            price: BigInt(input.price),
            expiresAt: BigInt(input.expiresAt),
          });
          return route.fulfill({
            headers,
            json: {
              ...prepared.operation,
              price: input.price,
              expiresAt: input.expiresAt,
            },
          });
        },
      );
      await context.route(
        `${apiOrigin}/artworks/${fixture.operation.kathaId}/operations/cancellation`,
        (route) => {
          if (route.request().method() === "OPTIONS")
            return route.fulfill({ status: 204, headers });
          assert.equal(
            route.request().headers().authorization,
            `Bearer ${"a".repeat(64)}`,
          );
          const input = route.request().postDataJSON();
          assert.equal(input.expectedRevision, "1");
          assert.deepEqual(Object.keys(input).sort(), [
            "expectedRevision",
            "idempotencyKey",
            "supportedTransactionVersions",
          ]);
          releasePreparations++;
          return route.fulfill({ headers, json: releaseFixture.operation });
        },
      );
      await context.route("http://127.0.0.1:8899/**", (route) => {
        const { method, id } = route.request().postDataJSON();
        const results = {
          getGenesisHash: "11111111111111111111111111111111",
          getBlockHeight: 1,
          simulateTransaction: {
            context: { slot: 30 },
            value: { err: null, unitsConsumed: 200 },
          },
          getFeeForMessage: { context: { slot: 30 }, value: 5000 },
        };
        assert.ok(method in results, `Unexpected RPC: ${method}`);
        return route.fulfill({
          headers,
          json: { jsonrpc: "2.0", id, result: results[method] },
        });
      });
      collectionMode = "READY";
      listingUnavailable = false;
      listingActive = false;
      await main
        .getByRole("button", { name: "Refresh collection", exact: true })
        .click();
      await main
        .getByRole("link", { name: "Offer this artwork for sale", exact: true })
        .click();
      await expect(
        main.getByRole("heading", { name: "Offer your artwork for sale." }),
      ).toBeVisible();
      const prepare = main.getByRole("button", {
        name: "Prepare listing for review",
        exact: true,
      });
      await expect(prepare).toBeEnabled();
      await main.getByLabel("Price in test tokens").fill("0");
      await main
        .getByLabel("Listing expiry (your local time)")
        .fill("2030-01-01T00:00");
      await prepare.click();
      await expect(main.getByRole("alert")).toContainText("positive amount");
      assert.equal(listingPreparations, 0);
      await main.getByLabel("Price in test tokens").fill("12.500001");
      await prepare.click();
      const review = main.getByRole("region", {
        name: "Listing transaction review",
        exact: true,
      });
      await expect(review).toContainText("Review transaction before wallet approval");
      await expect(main).toContainText("12500001 test-token base units");
      await expect(
        review.getByRole("button", { name: "Approve in wallet and submit" }),
      ).toBeVisible();
      assert.equal(listingPreparations, 1);
      assert.equal(
        await page.evaluate(() => globalThis.__kathaWalletTest.transactionCalls()),
        0,
      );
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.evaluate(() => document.activeElement?.blur());
      await page.screenshot({
        path: `/tmp/katha-123-listing-${width}.png`,
        fullPage: true,
      });
      await review.getByRole("button", { name: "Cancel transaction review" }).click();
      await expect(prepare).toBeDisabled();
      releaseMode = "ACTIVE";
      await main
        .getByRole("button", { name: "Refresh listing state", exact: true })
        .click();
      await expect(
        main.getByRole("button", { name: "Cancel listing", exact: true }),
      ).toBeEnabled();
      await main.getByRole("button", { name: "Cancel listing", exact: true }).click();
      await expect(review).toContainText("CANCEL LISTING");
      await expect(review).toContainText("Review transaction before wallet approval");
      assert.equal(releasePreparations, 1);
      assert.equal(
        await page.evaluate(() => globalThis.__kathaWalletTest.transactionCalls()),
        0,
      );
      await review
        .getByRole("button", { name: "Approve in wallet and submit" })
        .click();
      await expect(review).toContainText("Transaction not completed");
      await expect(main).not.toContainText("Cancellation recorded");
      await review.getByRole("button", { name: "Cancel transaction review" }).click();
      releaseMode = "EXPIRED";
      await main
        .getByRole("button", { name: "Refresh listing state", exact: true })
        .click();
      await expect(main).toContainText("Expiry alone does not unlock the asset");
      const release = main.getByRole("button", {
        name: "Release expired listing",
        exact: true,
      });
      await expect(release).toBeEnabled();
      await release.click();
      await expect(review).toContainText("Review transaction before wallet approval");
      assert.equal(releasePreparations, 2);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.evaluate(() => document.activeElement?.blur());
      await page.screenshot({
        path: `/tmp/katha-124-expired-listing-${width}.png`,
        fullPage: true,
      });
      await review.getByRole("button", { name: "Cancel transaction review" }).click();
      // Simulate cleanup finalized elsewhere, then read actual terminal observation.
      releaseMode = "CANCELLED";
      await main
        .getByRole("button", { name: "Refresh listing state", exact: true })
        .click();
      await expect(main).toContainText("Cancellation recorded");
      await expect(prepare).toBeEnabled();
      await expect(release).toHaveCount(0);

      await main
        .getByRole("link", { name: "Back to my collection", exact: true })
        .click();
      collectionMode = "READY";
      await main
        .getByRole("button", { name: "Refresh collection", exact: true })
        .click();
      await main
        .getByRole("link", { name: "Synthetic Paubha study", exact: true })
        .click();
      await main
        .getByRole("link", { name: "Review purchase quote", exact: true })
        .click();
      const quoteSigningBefore = await page.evaluate(() =>
        globalThis.__kathaWalletTest.transactionCalls(),
      );
      let quoteMode = "PRIMARY",
        quoteReads = 0;
      await context.route(
        `${apiOrigin}/artworks/${fixture.operation.kathaId}`,
        async (route) => {
          const { artwork } = await purchaseQuoteFixture();
          return route.fulfill({ headers, json: artwork });
        },
      );
      await context.route(
        `${apiOrigin}/artworks/${fixture.operation.kathaId}/purchase-quote`,
        async (route) => {
          if (route.request().method() === "OPTIONS")
            return route.fulfill({ status: 204, headers });
          assert.equal(
            route.request().headers().authorization,
            `Bearer ${"a".repeat(64)}`,
          );
          assert.deepEqual(Object.keys(route.request().postDataJSON()), [
            "supportedTransactionVersions",
          ]);
          quoteReads++;
          if (quoteMode === "FAIL")
            return route.fulfill({
              status: 409,
              headers,
              json: { privateError: "PRIVATE QUOTE ERROR" },
            });
          const { quote } = await purchaseQuoteFixture(
            quoteMode === "SECONDARY" ? "SECONDARY" : "PRIMARY",
            "100000001",
            quoteMode === "SECONDARY",
          );
          return route.fulfill({ headers, json: quote });
        },
      );
      await expect(
        main.getByRole("heading", { name: "Understand the purchase." }),
      ).toBeVisible();
      assert.equal(quoteReads, 0);
      const refreshQuote = main.getByRole("button", {
        name: "Refresh purchase quote",
        exact: true,
      });
      await refreshQuote.click();
      await expect(main).toContainText("Total: 100.000001 test tokens");
      await expect(main).toContainText("97.500001 test tokens");
      await expect(main).toContainText("0.000000 test tokens");
      await expect(main).toContainText("Expected listing revision");
      await expect(main).toContainText("Recorded physical custody");
      await expect(main).toContainText("No monetary value");
      quoteMode = "SECONDARY";
      await refreshQuote.click();
      await expect(main).toContainText("Secondary sale");
      await expect(main).toContainText("92.500001 test tokens");
      await expect(main).toContainText("5.000000 test tokens");
      await expect(main).toContainText("merged amounts");
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.evaluate(() => document.activeElement?.blur());
      await page.screenshot({
        path: `/tmp/katha-125-quote-${width}.png`,
        fullPage: true,
      });
      quoteMode = "FAIL";
      await refreshQuote.click();
      await expect(main.getByRole("alert")).toContainText("quote is unavailable");
      await expect(main).not.toContainText("92.500001 test tokens");
      await expect(main).not.toContainText("PRIVATE QUOTE ERROR");
      quoteMode = "PRIMARY";
      await refreshQuote.click();
      await expect(main).toContainText("100.000001 test tokens");
      assert.equal(
        await page.evaluate(() => globalThis.__kathaWalletTest.transactionCalls()),
        quoteSigningBefore,
      );
      const purchase = await purchaseFixture();
      let purchaseMode = "STALE",
        purchasePrepares = 0;
      await context.route(
        `${apiOrigin}/artworks/${fixture.operation.kathaId}/operations/purchase`,
        async (route) => {
          if (route.request().method() === "OPTIONS")
            return route.fulfill({ status: 204, headers });
          purchasePrepares++;
          const body = route.request().postDataJSON();
          assert.deepEqual(Object.keys(body).sort(), [
            "idempotencyKey",
            "quoteHash",
            "supportedTransactionVersions",
          ]);
          assert.equal(body.quoteHash, purchase.quote.quoteHash);
          assert.equal(
            route.request().headers().authorization,
            `Bearer ${"a".repeat(64)}`,
          );
          return purchaseMode === "STALE"
            ? route.fulfill({ status: 409, headers })
            : route.fulfill({ status: 201, headers, json: purchase.operation });
        },
      );
      await main
        .getByRole("button", { name: "Prepare reviewed purchase", exact: true })
        .click();
      await expect(main).toContainText("quote may be stale");
      await expect(main).not.toContainText("Total: 100.000001 test tokens");
      assert.equal(purchasePrepares, 1);
      purchaseMode = "READY";
      await refreshQuote.click();
      await main
        .getByRole("button", { name: "Prepare reviewed purchase", exact: true })
        .click();
      await expect(main).toContainText("Review transaction before wallet approval");
      await expect(main).toContainText("test-token payment below is included");
      await expect(main).toContainText("97500001 base units");
      assert.equal(
        await page.evaluate(() => globalThis.__kathaWalletTest.transactionCalls()),
        quoteSigningBefore,
      );
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.evaluate(() => {
        document.activeElement?.blur();
        globalThis.scrollTo(0, 0);
      });
      await page.screenshot({
        path: `/tmp/katha-126-purchase-${width}.png`,
        fullPage: true,
      });
      await main
        .getByRole("button", { name: "Approve in wallet and submit", exact: true })
        .click();
      await expect(main).toContainText(
        "Wallet approval or preflight was not completed",
      );
      assert.equal(
        await page.evaluate(() => globalThis.__kathaWalletTest.transactionCalls()),
        quoteSigningBefore + 1,
      );
      await main
        .getByRole("button", { name: "Cancel transaction review", exact: true })
        .click();
      await page.getByRole("button", { name: "Wallet connected", exact: true }).click();
      await page
        .locator("#wallet-connection-panel")
        .getByRole("link", { name: "My account", exact: true })
        .click();

      await expect(main).toContainText("This count reflects");
      mode = "FAIL";
      await main.getByRole("button", { name: "Refresh account" }).click();
      await expect(main.getByRole("alert")).toContainText("could not be loaded");
      await expect(main).not.toContainText("PRIVATE ACCOUNT ERROR");
      mode = "EMPTY";
      await main.getByRole("button", { name: "Try again", exact: true }).click();
      await expect(main).toContainText("No published artworks are indexed");
      mode = "REVOKED";
      await main.getByRole("button", { name: "Refresh account" }).click();
      await expect(
        main.getByRole("button", { name: "Sign in to Katha", exact: true }),
      ).toBeVisible();
      await expect(main).not.toContainText("Evaluated");
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log(
      "Collector account, collection, owner listing, release, purchase quote and private delivery/receipt and inspected resale browser checks passed at 375, 768 and 1280px, including axe accessibility, retry and revoked sessions.",
    );
  } finally {
    await browser.close();
  }
}
