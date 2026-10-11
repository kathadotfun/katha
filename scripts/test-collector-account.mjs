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
      // Header links stay client-side, so the in-memory wallet session survives.
      async function openAccount() {
        const menu = page.locator(".menubtn");
        if (await menu.isVisible()) {
          await menu.click();
          await page
            .locator("#mobile-navigation")
            .getByRole("link", { name: "Account", exact: true })
            .click();
        } else
          await page
            .getByRole("navigation", { name: "Main", exact: true })
            .getByRole("link", { name: /^Account, signed in as/ })
            .click();
        await expect(page).toHaveURL(`${origin}/account`);
      }
      async function audit() {
        assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
      }
      await page.goto(`${origin}/account`);
      const main = page.getByRole("main");
      await expect(
        main.getByRole("heading", { name: "Account", exact: true }),
      ).toBeVisible();
      assert.equal(accountCalls, 0);
      await expect(main).toContainText("Connecting shares your public address");
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
      await main.getByRole("button", { name: "Connect wallet", exact: true }).click();
      const chooser = page.getByRole("dialog", { name: "Choose a wallet" });
      await chooser
        .getByRole("button", { name: "Connect Synthetic test wallet" })
        .click();
      await expect(chooser).toBeHidden();
      await main.getByRole("button", { name: "Change account", exact: true }).click();
      await chooser.getByRole("button", { name: /^1111…1112/ }).click();
      await expect(main).toContainText("1111…1112");
      mode = "READY";
      await main
        .getByRole("button", { name: "Sign in with wallet", exact: true })
        .click();
      await expect(main).toContainText("Connected and signed in");
      await expect(main).toContainText("2 artworks indexed");
      await expect(main).toContainText("11111111111111111111111111111112");
      await audit();
      await page.evaluate(() => document.activeElement?.blur());
      await page.screenshot({
        path: `/tmp/katha-121-account-${width}.png`,
        fullPage: true,
      });
      await main.getByRole("link", { name: "View my collection", exact: true }).click();
      await expect(
        main.getByRole("heading", { name: "My collection", exact: true }),
      ).toBeVisible();
      await expect(main).toContainText("Held by Katha");
      await expect(main).toContainText(
        "Recent ownership changes are still being indexed",
      );
      await expect(main).toContainText("Not listed");
      listingActive = true;
      const refreshCollection = main.getByRole("button", {
        name: "Refresh",
        exact: true,
      });
      await refreshCollection.click();
      await expect(main).toContainText("Listed for sale");
      await expect(
        main.getByRole("link", { name: "Manage listing", exact: true }),
      ).toBeVisible();
      await audit();
      await page.evaluate(() => document.activeElement?.blur());
      await page.screenshot({
        path: `/tmp/katha-122-collection-${width}.png`,
        fullPage: true,
      });
      await main.getByRole("button", { name: "Next page", exact: true }).click();
      await expect(main).toContainText("No artworks on this page");
      await main.getByRole("button", { name: "Previous page", exact: true }).click();
      await expect(main).toContainText("Held by Katha");
      listingActive = false;
      await refreshCollection.click();
      await expect(main).toContainText("Not listed");
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
            assert.equal(input.kind, "DELIVERY");
            assert.deepEqual(input.addressLines, ["Synthetic address"]);
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
      await main.getByRole("link", { name: "Request delivery", exact: true }).click();
      await expect(
        main.getByRole("heading", { name: "Delivery and returns", exact: true }),
      ).toBeVisible();
      await expect(main).toContainText("You can request delivery");
      await main.getByLabel("Full name").fill("Synthetic recipient");
      await main.getByLabel("Address line 1").fill("Synthetic address");
      await main.getByLabel("City").fill("Synthetic city");
      const requestDelivery = main.getByRole("button", {
        name: "Request delivery",
        exact: true,
      });
      await requestDelivery.click();
      await expect(main.getByRole("alert")).toContainText("field needs attention");
      await expect(main).toContainText("Add an email address or a phone number");
      await expect(main.getByLabel("Full name")).toHaveValue("Synthetic recipient");
      assert.equal(deliveryWrites, 0);
      await main
        .getByRole("textbox", { name: /^Email/ })
        .fill("synthetic@example.invalid");
      await page.evaluate(() => {
        document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: `/tmp/katha-127-delivery-${width}.png`,
        fullPage: true,
      });
      await audit();
      await requestDelivery.click();
      await expect(main).toContainText("Katha is reviewing your request");
      await expect(main).toContainText("Delivery to you");
      assert.equal(deliveryWrites, 1);
      deliveryRequests = [{ ...deliveryRequests[0], status: "DISPATCHED" }];
      await main.getByRole("button", { name: "Refresh requests", exact: true }).click();
      const received = main.getByRole("button", { name: "I've received the painting" });
      await expect(received).toBeDisabled();
      await main.getByLabel("I physically received this artwork.").check();
      await received.click();
      await expect(main).toContainText("Receipt reported");
      await expect(main).toContainText(
        "Katha will record the custody change separately",
      );
      await expect(main).toContainText("In transit");
      deliveryFail = true;
      await main.getByRole("button", { name: "Refresh requests", exact: true }).click();
      await expect(main.getByRole("alert")).toContainText("could not be confirmed");
      await expect(main).not.toContainText("Synthetic address");
      await main.getByRole("link", { name: "Back to my collection" }).click();
      collectionMode = "COLLECTOR";
      await refreshCollection.click();
      await expect(main).toContainText("With you");
      resaleMode = "REQUIRED";
      await main.getByRole("link", { name: "Request inspection", exact: true }).click();
      await expect(
        main.getByRole("heading", { name: "Inspection and resale", exact: true }),
      ).toBeVisible();
      await expect(main).toContainText(
        "Katha needs to inspect this painting before you can list it",
      );
      await expect(
        main.getByRole("link", { name: "Continue to listing", exact: true }),
      ).toHaveCount(0);
      await main
        .getByRole("button", { name: "Request inspection", exact: true })
        .click();
      await expect(main).toContainText("Inspection requested");
      assert.equal(resaleWrites, 1);
      assert.equal(
        await page.evaluate(() => globalThis.__kathaWalletTest.transactionCalls()),
        0,
      );
      await audit();
      await page.evaluate(() => {
        document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: `/tmp/katha-128-resale-${width}.png`,
        fullPage: true,
      });
      const refreshResale = main.getByRole("button", {
        name: "Refresh inspection status",
      });
      resaleMode = "APPROVED";
      await refreshResale.click();
      await expect(main).toContainText("Approved for resale");
      await expect(
        main.getByRole("link", { name: "Continue to listing", exact: true }),
      ).toBeVisible();
      resaleMode = "EXPIRED";
      await refreshResale.click();
      await expect(main).toContainText("Your resale approval has expired");
      await expect(
        main.getByRole("link", { name: "Continue to listing", exact: true }),
      ).toHaveCount(0);
      resaleMode = "KATHA_HELD";
      await main.getByRole("link", { name: "Back to my collection" }).click();
      listingUnavailable = true;
      await refreshCollection.click();
      await expect(main).toContainText("With you");
      await expect(main).toContainText("Listing status unavailable");
      collectionMode = "FAIL";
      await refreshCollection.click();
      await expect(main.getByRole("alert")).toContainText("couldn't load");
      await expect(main).not.toContainText("With you");
      collectionMode = "EMPTY";
      await main.getByRole("button", { name: "Try again", exact: true }).click();
      await expect(main).toContainText("You don't own any artworks yet");
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
      await refreshCollection.click();
      await main.getByRole("link", { name: "List for sale", exact: true }).click();
      await expect(
        main.getByRole("heading", { name: "Manage listing", exact: true }),
      ).toBeVisible();
      const prepare = main.getByRole("button", { name: "Review listing", exact: true });
      await expect(prepare).toBeEnabled();
      await main.getByLabel("Price", { exact: false }).fill("0");
      await main.getByLabel("Listing ends", { exact: false }).fill("2030-01-01T00:00");
      await prepare.click();
      await expect(main.getByRole("alert")).toContainText("field needs attention");
      await expect(main).toContainText("Enter a price greater than 0");
      assert.equal(listingPreparations, 0);
      await main.getByLabel("Price", { exact: false }).fill("12.500001");
      await prepare.click();
      const review = main.getByRole("region", { name: "Review listing", exact: true });
      await expect(review).toContainText("Review transaction before wallet approval");
      await expect(review).toContainText(
        "12.500001 Katha test token (12500001 base units)",
      );
      await expect(
        review.getByRole("button", { name: "Approve in wallet" }),
      ).toBeVisible();
      assert.equal(listingPreparations, 1);
      assert.equal(
        await page.evaluate(() => globalThis.__kathaWalletTest.transactionCalls()),
        0,
      );
      await audit();
      await page.evaluate(() => document.activeElement?.blur());
      await page.screenshot({
        path: `/tmp/katha-123-listing-${width}.png`,
        fullPage: true,
      });
      await review.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(prepare).toHaveCount(0);
      releaseMode = "ACTIVE";
      const refreshListing = main.getByRole("button", {
        name: "Refresh listing state",
        exact: true,
      });
      await refreshListing.click();
      await expect(main).toContainText("Your listing is live");
      await main.getByRole("button", { name: "Cancel listing", exact: true }).click();
      const confirmCancel = main.getByRole("alertdialog", {
        name: "Cancel this listing?",
      });
      await expect(confirmCancel).toBeVisible();
      await confirmCancel
        .getByRole("button", { name: "Cancel listing", exact: true })
        .click();
      const cancelReview = main.getByRole("region", {
        name: "Cancel listing",
        exact: true,
      });
      await expect(cancelReview).toContainText("cancel listing ·");
      await expect(cancelReview).toContainText(
        "Review transaction before wallet approval",
      );
      assert.equal(releasePreparations, 1);
      assert.equal(
        await page.evaluate(() => globalThis.__kathaWalletTest.transactionCalls()),
        0,
      );
      await cancelReview.getByRole("button", { name: "Approve in wallet" }).click();
      await expect(cancelReview).toContainText("Transaction not completed");
      await cancelReview.getByRole("button", { name: "Cancel", exact: true }).click();
      releaseMode = "EXPIRED";
      await refreshListing.click();
      await expect(main).toContainText(
        "The asset stays locked until you release the listing",
      );
      const release = main.getByRole("button", {
        name: "Release expired listing",
        exact: true,
      });
      await expect(release).toBeEnabled();
      await release.click();
      await expect(cancelReview).toContainText(
        "Review transaction before wallet approval",
      );
      assert.equal(releasePreparations, 2);
      await audit();
      await page.evaluate(() => document.activeElement?.blur());
      await page.screenshot({
        path: `/tmp/katha-124-expired-listing-${width}.png`,
        fullPage: true,
      });
      await cancelReview.getByRole("button", { name: "Cancel", exact: true }).click();
      // Simulate cleanup finalized elsewhere, then read the actual terminal observation.
      releaseMode = "CANCELLED";
      await refreshListing.click();
      await expect(prepare).toBeEnabled();
      await expect(release).toHaveCount(0);

      await main
        .getByRole("link", { name: "Back to my collection", exact: true })
        .click();
      collectionMode = "READY";
      await refreshCollection.click();
      await main
        .getByRole("link", { name: "Synthetic Paubha study", exact: true })
        .click();
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
      const quoteSigningBefore = await page.evaluate(() =>
        globalThis.__kathaWalletTest.transactionCalls(),
      );
      await main.getByRole("link", { name: "Review purchase", exact: true }).click();
      await expect(
        main.getByRole("heading", { name: "Review purchase", exact: true }),
      ).toBeVisible();
      // Signed-in buyers see current terms on arrival; quotes never reserve the work.
      await expect(main).toContainText(
        "Katha test token, exact total (100000001 base units)",
      );
      assert.ok(quoteReads >= 1);
      await expect(main).toContainText("97.500001");
      await expect(main).toContainText("Primary sale");
      await expect(main).toContainText("Recorded custody");
      await expect(main).toContainText("No monetary value");
      await expect(main).toContainText("A quote doesn't reserve the work.");
      const refreshQuote = main.getByRole("button", {
        name: "Refresh terms",
        exact: true,
      });
      quoteMode = "SECONDARY";
      await refreshQuote.click();
      await expect(main).toContainText("Secondary sale");
      await expect(main).toContainText("92.500001");
      await expect(main).toContainText("merged totals");
      await audit();
      await page.evaluate(() => document.activeElement?.blur());
      await page.screenshot({
        path: `/tmp/katha-125-quote-${width}.png`,
        fullPage: true,
      });
      quoteMode = "FAIL";
      await refreshQuote.click();
      await expect(main.getByRole("alert")).toContainText(
        "Purchase terms aren't available",
      );
      await expect(main).not.toContainText("92.500001");
      await expect(main).not.toContainText("PRIVATE QUOTE ERROR");
      quoteMode = "PRIMARY";
      await refreshQuote.click();
      await expect(main).toContainText("100000001 base units");
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
      const prepareTransaction = main.getByRole("button", {
        name: "Prepare transaction",
        exact: true,
      });
      await prepareTransaction.click();
      await expect(main).toContainText("quote may be stale");
      await expect(main).not.toContainText("100000001 base units");
      assert.equal(purchasePrepares, 1);
      purchaseMode = "READY";
      await refreshQuote.click();
      await expect(main).toContainText("100000001 base units");
      await prepareTransaction.click();
      await expect(main).toContainText("Review transaction before wallet approval");
      await expect(main).toContainText(
        "The test-token payment above is part of this operation",
      );
      await expect(main).toContainText("97500001 base units");
      assert.equal(
        await page.evaluate(() => globalThis.__kathaWalletTest.transactionCalls()),
        quoteSigningBefore,
      );
      await audit();
      await page.evaluate(() => {
        document.activeElement?.blur();
        globalThis.scrollTo(0, 0);
      });
      await page.screenshot({
        path: `/tmp/katha-126-purchase-${width}.png`,
        fullPage: true,
      });
      await main
        .getByRole("button", { name: "Approve in wallet", exact: true })
        .click();
      await expect(main).toContainText(
        "Wallet approval or preflight was not completed",
      );
      assert.equal(
        await page.evaluate(() => globalThis.__kathaWalletTest.transactionCalls()),
        quoteSigningBefore + 1,
      );
      await main.getByRole("button", { name: "Cancel", exact: true }).click();
      mode = "FAIL";
      await openAccount();
      await expect(main.getByRole("alert")).toContainText("couldn't load");
      await expect(main).not.toContainText("PRIVATE ACCOUNT ERROR");
      mode = "EMPTY";
      await main.getByRole("button", { name: "Try again", exact: true }).click();
      await expect(main).toContainText("0 artworks indexed");
      mode = "REVOKED";
      await main.getByRole("link", { name: "View my collection", exact: true }).click();
      await openAccount();
      await expect(
        main.getByRole("button", { name: "Sign in with wallet", exact: true }),
      ).toBeVisible();
      await expect(main).not.toContainText("artworks indexed");
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
