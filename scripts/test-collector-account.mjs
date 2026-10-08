/* global document, innerWidth */
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
      let issuedSession;
      let mode = "EMPTY";
      let accountCalls = 0;
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
      "Collector account browser checks passed at 375, 768 and 1280px, including axe accessibility, retry and revoked sessions.",
    );
  } finally {
    await browser.close();
  }
}
