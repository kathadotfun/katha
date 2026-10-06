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
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Cache-Control": "no-store",
      };
      const authSession = () => ({
        walletId: "bbbbbbbb-1111-4111-8111-111111111111",
        walletAddress: "11111111111111111111111111111112",
        cluster: "localnet",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
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
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
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
