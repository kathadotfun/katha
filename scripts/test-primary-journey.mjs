import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const evidence = "a".repeat(64);
const privatePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
  "base64",
);

// Only the wallet transport is synthetic. Every HTTP request and transaction
// uses the production application and the owned local test services.
export async function runPrimaryJourney(context) {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (
      await globalThis
        .fetch(context.origin)
        .then((r) => r.ok)
        .catch(() => false)
    ) {
      ready = true;
      break;
    }
    await delay(100);
  }
  assert.ok(ready, "Production web readiness");
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const requests = [];
  const tokens = [];
  const pages = [];
  try {
    for (const actor of context.custodyResale ? [0, 1, 2, 4] : [0, 1, 2]) {
      const session = await browser.newContext({ timezoneId: "UTC" });
      const page = await session.newPage();
      pages.push(page);
      page.on("requestfailed", (request) =>
        requests.push(
          `${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`,
        ),
      );
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("response", async (response) => {
        if (new URL(response.url()).origin === context.apiOrigin)
          requests.push(
            `${response.request().method()} ${new URL(response.url()).pathname}: ${response.status()}`,
          );
        if (response.url() === `${context.apiOrigin}/auth/verify` && response.ok()) {
          tokens[actor] = (await response.json()).token;
        }
      });
      await page.exposeFunction("kathaTestSignMessage", (bytes) => [
        ...context.actors[actor].sign(Uint8Array.from(bytes)),
      ]);
      await page.exposeFunction("kathaTestSignTransaction", (bytes) =>
        context.signTransaction(actor, bytes),
      );
      await page.addInitScript(({ address, publicKey }) => {
        const account = {
          address,
          publicKey: Uint8Array.from(publicKey),
          chains: ["solana:localnet"],
          features: ["solana:signMessage", "solana:signTransaction"],
        };
        let connected = false;
        const wallet = {
          version: "1.0.0",
          name: "Primary journey wallet",
          icon: "data:image/svg+xml;base64,PHN2Zy8+",
          chains: ["solana:localnet"],
          get accounts() {
            return connected ? [account] : [];
          },
          features: {
            "standard:connect": {
              version: "1.0.0",
              connect: async () => {
                connected = true;
                return { accounts: [account] };
              },
            },
            "standard:disconnect": {
              version: "1.0.0",
              disconnect: async () => {
                connected = false;
              },
            },
            "standard:events": { version: "1.0.0", on: () => () => {} },
            "solana:signMessage": {
              version: "1.0.0",
              signMessage: async (...inputs) =>
                Promise.all(
                  inputs.map(async (input) => ({
                    signedMessage: input.message,
                    signature: Uint8Array.from(
                      await globalThis.kathaTestSignMessage([...input.message]),
                    ),
                  })),
                ),
            },
            "solana:signTransaction": {
              version: "1.0.0",
              supportedTransactionVersions: [0],
              signTransaction: async (...inputs) => {
                if (globalThis.kathaTestRejectNext) {
                  globalThis.kathaTestRejectNext = false;
                  throw new Error("Synthetic wallet rejection");
                }
                return Promise.all(
                  inputs.map(async (input) => ({
                    signedTransaction: Uint8Array.from(
                      await globalThis.kathaTestSignTransaction([...input.transaction]),
                    ),
                  })),
                );
              },
            },
          },
        };
        const register = (api) => api.register(wallet);
        globalThis.addEventListener("wallet-standard:app-ready", (event) =>
          register(event.detail),
        );
        globalThis.dispatchEvent(
          new globalThis.CustomEvent("wallet-standard:register-wallet", {
            detail: register,
          }),
        );
      }, context.actors[actor]);
    }
    const [admin, verifier, buyer, secondBuyer] = pages;
    async function visit(page, path) {
      globalThis.console.log(`Primary journey: ${path}`);
      // The wallet session lives in memory, so sign in on the account page and
      // continue to the target with a client-side navigation.
      await page.goto(`${context.origin}/account?next=${encodeURIComponent(path)}`);
      const main = page.getByRole("main");
      await main.getByRole("button", { name: "Connect wallet", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Choose a wallet" })
        .getByRole("button", { name: "Connect Primary journey wallet", exact: true })
        .click();
      await main
        .getByRole("button", { name: "Sign in with wallet", exact: true })
        .click();
      await expect(
        main.getByText("Connected and signed in", { exact: true }),
      ).toBeVisible();
      await main
        .getByRole("link", { name: "Continue where you left off", exact: true })
        .click();
      await expect(page).toHaveURL(`${context.origin}${path}`);
    }
    async function postResult(page, path, action, method = "POST") {
      const pending = page.waitForResponse(
        (r) =>
          r.url() === `${context.apiOrigin}${path}` && r.request().method() === method,
      );
      await action();
      const response = await pending;
      assert.ok(response.ok(), `${path}: HTTP ${response.status()}`);
      return response.json();
    }
    async function transact(
      page,
      prepare,
      indexed = "Transaction finalized and artwork history updated",
    ) {
      globalThis.console.log(`Primary journey: ${prepare}`);
      await page.getByRole("button", { name: prepare, exact: true }).click();
      const approve = page.getByRole("button", {
        name: "Approve in wallet",
        exact: true,
      });
      await expect(approve).toBeEnabled({ timeout: 15000 });
      let finalized = false;
      let failed = false;
      const observe = async (response) => {
        if (
          response.url().includes("/receipts") &&
          response.request().method() === "POST" &&
          response.ok()
        ) {
          const receipt = await response.json();
          failed ||= receipt.status === "FAILED";
          finalized ||= receipt.status === "FINALIZED";
        }
      };
      page.on("response", observe);
      try {
        await approve.click();
        const retry = page.getByRole("button", {
          name: "Check status",
          exact: true,
        });
        await expect
          .poll(
            async () => {
              assert.equal(failed, false, "Local transaction failed");
              if (finalized) return true;
              if ((await retry.isVisible()) && (await retry.isEnabled()))
                await retry.click();
              return finalized;
            },
            { timeout: 45000, intervals: [500, 1000] },
          )
          .toBe(true);
        await context.index();
        await expect
          .poll(
            async () => {
              if (await page.getByText(indexed, { exact: true }).isVisible())
                return true;
              if ((await retry.isVisible()) && (await retry.isEnabled()))
                await retry.click();
              return false;
            },
            { timeout: 30000, intervals: [500, 1000] },
          )
          .toBe(true);
      } finally {
        page.off("response", observe);
      }
    }

    await visit(buyer, "/admin");
    await expect(
      buyer.getByText("You don't have access to operations", { exact: true }),
    ).toBeVisible();
    const forbidden = await globalThis.fetch(`${context.apiOrigin}/admin/artists`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokens[2]}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(forbidden.status, 403);
    await visit(admin, "/admin");
    for (const [name, value] of [
      ["displayName", "Synthetic Nepali artist"],
      ["slug", `primary-${randomUUID()}`],
      ["biography", "Fictional Paubha artist for local browser verification."],
      ["region", "Patan"],
      ["payoutWallet", context.actors[3].address],
    ])
      await admin.locator(`[name="${name}"]`).fill(value);
    await admin.getByRole("checkbox", { name: "Paubha", exact: true }).check();
    const artist = await postResult(admin, "/admin/artists", () =>
      admin.getByRole("button", { name: "Create artist", exact: true }).click(),
    );
    await visit(verifier, "/admin");
    await verifier.getByLabel("Artist record ID", { exact: true }).fill(artist.id);
    await verifier.getByRole("button", { name: "Look up", exact: true }).click();
    await verifier
      .getByRole("checkbox", { name: /checked this artist's identity/ })
      .check();
    await postResult(verifier, `/verifier/artists/${artist.id}/verification`, () =>
      verifier
        .getByRole("button", { name: "Record verification", exact: true })
        .click(),
    );
    await visit(admin, "/admin/artworks/new");
    for (const [name, value] of Object.entries({
      artistId: artist.id,
      creationYear: "2026",
      title: "Synthetic Patan Paubha",
      countryCode: "NP",
      region: "Patan",
      heightMm: "600",
      widthMm: "400",
      materials: "Cotton\nMineral pigment",
      story: "Synthetic Nepali artwork for the local test journey.",
      meaning: "Synthetic test meaning.",
      culturalContext: "Synthetic Paubha documentation from Patan, Nepal.",
      creationProcess: "Synthetic test process.",
      technique: "Mineral pigment on cotton",
      authorshipEvidenceHash: evidence,
    }))
      await admin.locator(`[name="${name}"]`).fill(value);
    await admin.getByRole("radio", { name: "Paubha", exact: true }).check();
    const draft = await postResult(admin, "/admin/artworks", () =>
      admin.getByRole("button", { name: "Create artwork", exact: true }).click(),
    );
    const id = draft.kathaId;
    assert.ok(id);
    await visit(admin, `/admin/artworks/${id}/media`);
    await admin
      .locator('[name="file"]')
      .setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: png });
    await admin.locator('[name="role"]').selectOption("HERO");
    await admin.locator('[name="visibility"][value="PUBLIC"]').check();
    await admin.locator('[name="approvedPublic"]').check();
    await admin.locator('[name="altText"]').fill("Synthetic Paubha test image");
    await admin.getByRole("button", { name: "Upload file", exact: true }).click();
    await expect(admin.getByText("Media saved.", { exact: true })).toBeVisible();
    await visit(admin, `/admin/artworks/${id}/registration`);
    await admin.getByRole("button", { name: "Prepare document", exact: true }).click();
    await admin
      .getByRole("checkbox", { name: /I reviewed the permanent identity/ })
      .check();
    await transact(admin, "Prepare and simulate registration");
    await visit(verifier, `/admin/artworks/${id}/verification`);
    await verifier
      .getByLabel(/^Fingerprint of the evidence you reviewed/)
      .fill(evidence);
    await verifier
      .getByRole("checkbox", { name: /inspected this physical artwork in person/ })
      .check();
    await verifier
      .getByRole("checkbox", { name: /authorship evidence supports attribution/ })
      .check();
    await transact(verifier, "Prepare verification transaction");
    await visit(verifier, `/admin/artworks/${id}/condition`);
    await verifier.getByLabel("Add an evidence image", { exact: true }).setInputFiles({
      name: "private.png",
      mimeType: "image/png",
      buffer: privatePng,
    });
    await verifier
      .getByRole("button", { name: "Upload private evidence", exact: true })
      .click();
    await verifier.getByRole("checkbox", { name: /Evidence image 1/ }).check();
    const privateHash = createHash("sha256").update(privatePng).digest("hex");
    assert.equal(
      (await globalThis.fetch(`${context.apiOrigin}/storage/public/${privateHash}.png`))
        .status,
      404,
    );
    await verifier.getByRole("radio", { name: "Good", exact: true }).check();
    await verifier.getByLabel(/^Inspector record ID/).fill(randomUUID());
    await verifier
      .getByLabel(/^Inspected at/)
      .fill(new Date(Date.now() - 60000).toISOString().slice(0, 16));
    await verifier.getByLabel(/^Notes/).fill("Synthetic private inspection notes");
    await verifier
      .getByRole("checkbox", { name: /I inspected this work in person/ })
      .check();
    await verifier.getByRole("button", { name: "Prepare report", exact: true }).click();
    await verifier
      .getByRole("checkbox", { name: /I reviewed the exact saved report/ })
      .check();
    await context.waitForClock();
    await transact(verifier, "Prepare and simulate the report transaction");
    await visit(admin, `/admin/artworks/${id}/custody`);
    await admin
      .getByLabel("Physical movement", { exact: true })
      .selectOption("ATTEST_KATHA_CUSTODY");
    await admin
      .getByRole("checkbox", { name: /this physical movement has already happened/ })
      .check();
    await transact(admin, "Review custody change");
    await visit(admin, `/admin/artworks/${id}/metadata`);
    await admin
      .getByRole("checkbox", {
        name: /I reviewed the saved document/,
      })
      .check();
    await transact(admin, "Prepare metadata revision");
    await visit(admin, `/admin/artworks/${id}/minting`);
    await admin
      .getByRole("checkbox", { name: /I reviewed the public metadata/ })
      .check();
    await transact(admin, "Review and approve mint");
    await admin
      .getByRole("button", { name: "Reload saved state", exact: true })
      .click();
    await admin.getByRole("button", { name: "Publish artwork", exact: true }).click();
    const publish = admin.getByRole("alertdialog");
    await publish
      .getByRole("checkbox", { name: /I reviewed the finalized asset/ })
      .check();
    await publish.getByRole("button", { name: "Publish artwork", exact: true }).click();
    await expect(
      admin.getByRole("link", { name: "View public record", exact: true }),
    ).toBeVisible();
    await context.initializeSaleTerms(id);
    const tagId = randomUUID();
    const tag = await globalThis.fetch(
      `${context.apiOrigin}/admin/artworks/${id}/nfc-tags`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${tokens[0]}`,
        },
        body: JSON.stringify({ tagId }),
      },
    );
    assert.equal(tag.status, 200);
    const resolved = await globalThis.fetch(`${context.apiOrigin}/nfc/${tagId}`, {
      redirect: "manual",
    });
    assert.equal(resolved.status, 302);
    assert.equal(resolved.headers.get("location"), `${context.origin}/art/${id}`);
    await visit(admin, `/collection/${id}/list`);
    await admin
      .getByRole("button", { name: "Refresh listing state", exact: true })
      .click();
    await admin.getByLabel(/^Price/).fill("1");
    await admin
      .getByLabel(/^Listing ends/)
      .fill(new Date(Date.now() + 3600000).toISOString().slice(0, 16));
    await transact(
      admin,
      "Review listing",
      "Transaction finalized and active listing observed",
    );
    // Resolve the canonical path against the local server: this test never
    // navigates to a hosted domain or writes a physical NFC tag.
    await visit(buyer, new URL(resolved.headers.get("location")).pathname);
    await expect(
      buyer.getByRole("heading", { name: "Synthetic Patan Paubha", exact: true }),
    ).toBeVisible();
    await buyer.getByRole("link", { name: "Review purchase", exact: true }).click();
    await buyer.getByRole("button", { name: "Refresh terms", exact: true }).click();
    if (context.trust) {
      await buyer
        .getByRole("button", { name: "Prepare transaction", exact: true })
        .click();
      const approve = buyer.getByRole("button", {
        name: "Approve in wallet",
        exact: true,
      });
      await expect(approve).toBeEnabled();
      await buyer.evaluate(() => {
        globalThis.kathaTestRejectNext = true;
      });
      await approve.click();
      await expect(
        buyer.getByText(
          "Wallet approval or preflight was not completed. No transaction was submitted.",
          { exact: true },
        ),
      ).toBeVisible();
      await context.trust.assertRejected(id);
      await buyer.getByRole("button", { name: "Cancel", exact: true }).click();
      await postResult(buyer, `/artworks/${id}/purchase-quote`, () =>
        buyer.getByRole("button", { name: "Refresh terms", exact: true }).click(),
      );
    }
    await transact(
      buyer,
      "Prepare transaction",
      "Purchase finalized; buyer Core ownership confirmed and transfer history indexed",
    );
    await context.assertPurchase(id, artist.id);
    const afterSaleTag = await globalThis.fetch(`${context.apiOrigin}/nfc/${tagId}`, {
      redirect: "manual",
    });
    assert.equal(afterSaleTag.status, 302);
    assert.equal(
      afterSaleTag.headers.get("location"),
      resolved.headers.get("location"),
    );
    await visit(buyer, "/collection");
    await buyer.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      buyer.getByText("Synthetic Patan Paubha", { exact: true }).first(),
    ).toBeVisible();
    async function move(action, requestId) {
      await visit(admin, `/admin/artworks/${id}/custody`);
      if (requestId)
        await admin
          .getByLabel("Related fulfillment request", { exact: true })
          .selectOption(requestId);
      await admin.getByLabel("Physical movement", { exact: true }).selectOption(action);
      await admin
        .getByRole("checkbox", { name: /this physical movement has already happened/ })
        .check();
      await transact(admin, "Review custody change");
    }
    async function inspect(reason) {
      await visit(verifier, `/admin/artworks/${id}/condition`);
      await verifier.getByRole("checkbox", { name: /Evidence image 1/ }).check();
      await verifier.getByRole("radio", { name: "Good", exact: true }).check();
      await verifier.getByLabel(/^Reason/).selectOption(reason);
      await verifier.getByLabel(/^Inspector record ID/).fill(randomUUID());
      await verifier
        .getByLabel(/^Inspected at/)
        .fill(new Date(Date.now() - 60000).toISOString().slice(0, 16));
      await verifier
        .getByLabel(/^Notes/)
        .fill(`Synthetic private ${reason} inspection`);
      await verifier
        .getByRole("checkbox", { name: /I inspected this work in person/ })
        .check();
      await verifier
        .getByRole("button", { name: "Prepare report", exact: true })
        .click();
      await verifier
        .getByRole("checkbox", { name: /I reviewed the exact saved report/ })
        .check();
      await context.waitForClock();
      await transact(verifier, "Prepare and simulate the report transaction");
    }
    let delivery;
    if (context.collectorDelivery) {
      await visit(buyer, `/collection/${id}/delivery`);
      await buyer.getByLabel("Full name").fill("Synthetic Collector A");
      await buyer
        .getByRole("textbox", { name: /^Email/ })
        .fill("synthetic-collector@example.invalid");
      await buyer.getByLabel("Address line 1").fill("Private Test Lane");
      await buyer.getByLabel("City").fill("Patan");
      delivery = await postResult(buyer, `/fulfillment/artworks/${id}`, () =>
        buyer.getByRole("button", { name: "Request delivery", exact: true }).click(),
      );
      const status = async (value) => {
        await visit(admin, `/admin/artworks/${id}/custody`);
        const card = admin.locator(`section[aria-labelledby="request-${delivery.id}"]`);
        if (value === "DISPATCHED") {
          await card.getByLabel(/^Courier/).fill("Synthetic courier");
          await card.getByLabel(/^Tracking number/).fill("PRIVATE-TEST-TRACKING");
        }
        await card
          .getByRole("checkbox", { name: /I confirmed this update manually/ })
          .check();
        const action = {
          APPROVED: "Approve request",
          DISPATCHED: "Mark dispatched",
          RECEIVED: "Mark received",
        }[value];
        delivery = await postResult(
          admin,
          `/admin/fulfillment/${delivery.id}`,
          () => card.getByRole("button", { name: action, exact: true }).click(),
          "PATCH",
        );
      };
      await status("APPROVED");
      await move("DISPATCH_FROM_KATHA", delivery.id);
      await status("DISPATCHED");
      await context.collectorDelivery.assertState(id, "IN_TRANSIT_A");
      await visit(buyer, `/collection/${id}/delivery`);
      await buyer
        .getByRole("checkbox", {
          name: "I physically received this artwork.",
          exact: true,
        })
        .check();
      delivery = await postResult(buyer, `/fulfillment/${delivery.id}/receipt`, () =>
        buyer
          .getByRole("button", { name: "I've received the painting", exact: true })
          .click(),
      );
      assert.equal(delivery.status, "DISPATCHED");
      assert.ok(delivery.ownerReportedReceivedAt);
      await context.collectorDelivery.assertState(id, "RECEIPT_A");
      await move("RECEIVE_BY_COLLECTOR", delivery.id);
      await status("RECEIVED");
      await context.collectorDelivery.assertState(id, "HELD_A");
      await inspect("POST_DELIVERY");
      await context.collectorDelivery.assertState(id, "POST_DELIVERY_A");
      await visit(buyer, `/collection/${id}/resale`);
      await expect(
        buyer.getByText("Katha needs to inspect this painting before you can list it", {
          exact: true,
        }),
      ).toBeVisible();
      const request = await postResult(buyer, `/resale/artworks/${id}`, () =>
        buyer.getByRole("button", { name: "Request inspection", exact: true }).click(),
      );
      assert.equal(request.inspection.status, "REQUIRED");
      assert.equal(request.canList, false);
      await visit(buyer, `/collection/${id}/list`);
      await buyer
        .getByRole("button", { name: "Refresh listing state", exact: true })
        .click();
      await expect(buyer.getByText("This work can't be listed yet.")).toBeVisible();
      await expect(
        buyer.getByRole("button", { name: "Review listing", exact: true }),
      ).toHaveCount(0);
      const refused = await globalThis.fetch(
        `${context.apiOrigin}/artworks/${id}/operations/listing`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${tokens[2]}`,
          },
          body: JSON.stringify({
            idempotencyKey: randomUUID(),
            expectedRevision: "2",
            price: "2000000",
            expiresAt: String(Math.floor(Date.now() / 1000) + 3600),
            supportedTransactionVersions: [0],
          }),
        },
      );
      assert.equal(refused.status, 409);
      await visit(verifier, `/admin/artworks/${id}/condition`);
      await verifier
        .getByRole("button", { name: "Refresh requests", exact: true })
        .click();
      await expect(verifier.getByText(/custody revision 3/i).first()).toBeVisible();
      await inspect("PRE_RESALE");
      await context.collectorDelivery.assertState(id, "APPROVED_A");
      await context.trust?.verify(id, tokens[0], tokens[2]);
      await visit(buyer, `/collection/${id}/resale`);
      await expect(buyer.getByText("Approved for resale").first()).toBeVisible();
    }
    if (context.custodyResale) {
      const listingRequest = {
        idempotencyKey: randomUUID(),
        expectedRevision: "2",
        price: "2000000",
        expiresAt: String(Math.floor(Date.now() / 1000) + 3600),
        supportedTransactionVersions: [0],
      };
      const post = (path, actor, body) =>
        globalThis.fetch(`${context.apiOrigin}${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${tokens[actor]}`,
          },
          body: JSON.stringify(body),
        });
      // An administrator role does not override Core ownership after the primary sale.
      await visit(admin, `/collection/${id}/list`);
      await admin
        .getByRole("button", { name: "Refresh listing state", exact: true })
        .click();
      await expect(
        admin.getByText("The connected wallet is not the observed Core owner.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        admin.getByRole("button", { name: "Review listing", exact: true }),
      ).toHaveCount(0);
      assert.equal(
        (await post(`/artworks/${id}/operations/listing`, 0, listingRequest)).status,
        403,
      );

      await visit(buyer, `/collection/${id}/list`);
      await buyer
        .getByRole("button", { name: "Refresh listing state", exact: true })
        .click();
      await expect(buyer.getByText("Eligible to list", { exact: true })).toBeVisible();
      await buyer.getByLabel(/^Price/).fill("2");
      await buyer
        .getByLabel(/^Listing ends/)
        .fill(new Date(Date.now() + 3600000).toISOString().slice(0, 16));
      await transact(
        buyer,
        "Review listing",
        "Transaction finalized and active listing observed",
      );
      await context.custodyResale.assertListed(id);
      assert.equal(
        (
          await post(`/artworks/${id}/purchase-quote`, 2, {
            supportedTransactionVersions: [0],
          })
        ).status,
        403,
      );

      await visit(secondBuyer, new URL(resolved.headers.get("location")).pathname);
      await secondBuyer
        .getByRole("link", { name: "Review purchase", exact: true })
        .click();
      await context.trust?.verifyExpiredPurchase(id, tokens[4]);
      const quote = await postResult(
        secondBuyer,
        `/artworks/${id}/purchase-quote`,
        () =>
          secondBuyer
            .getByRole("button", { name: "Refresh terms", exact: true })
            .click(),
      );
      assert.equal(quote.saleKind, "SECONDARY");
      assert.equal(quote.revision, "3");
      assert.deepEqual(quote.distribution.sellerProceeds, "1850000");
      assert.deepEqual(quote.distribution.artistProceeds, "100000");
      assert.deepEqual(quote.distribution.treasuryFee, "50000");
      await expect(
        secondBuyer.getByText("Secondary sale", { exact: true }),
      ).toBeVisible();
      await expect(
        secondBuyer.getByRole("row", { name: "Total 2", exact: true }),
      ).toBeVisible();
      await transact(
        secondBuyer,
        "Prepare transaction",
        "Purchase finalized; buyer Core ownership confirmed and transfer history indexed",
      );
      // A consumed quote and the previous owner cannot create another settlement.
      assert.equal(
        (
          await post(`/artworks/${id}/operations/purchase`, 4, {
            supportedTransactionVersions: [0],
            idempotencyKey: randomUUID(),
            quoteHash: quote.quoteHash,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await post(`/artworks/${id}/operations/listing`, 2, {
            ...listingRequest,
            idempotencyKey: randomUUID(),
            expectedRevision: "4",
          })
        ).status,
        403,
      );
      await context.custodyResale.assertResale(id);
      const finalTag = await globalThis.fetch(`${context.apiOrigin}/nfc/${tagId}`, {
        redirect: "manual",
      });
      assert.equal(finalTag.status, 302);
      assert.equal(finalTag.headers.get("location"), resolved.headers.get("location"));
      await visit(buyer, "/collection");
      await buyer.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(
        buyer.getByText("You don't own any artworks yet", { exact: true }),
      ).toBeVisible();
      await expect(
        buyer.getByText("Synthetic Patan Paubha", { exact: true }),
      ).toHaveCount(0);
      await visit(secondBuyer, "/collection");
      await secondBuyer.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(
        secondBuyer.getByText("Synthetic Patan Paubha", { exact: true }).first(),
      ).toBeVisible();
    }
    if (context.collectorDelivery) {
      await context.collectorDelivery.assertState(id, "SOLD_HELD_A");
      const priorDelivery = await globalThis.fetch(
        `${context.apiOrigin}/fulfillment/${delivery.id}`,
        { headers: { authorization: `Bearer ${tokens[4]}` } },
      );
      assert.equal(priorDelivery.status, 403);
      const mismatchedScope = await globalThis.fetch(
        `${context.apiOrigin}/resale/artworks/${id}`,
        { headers: { authorization: `Bearer ${tokens[4]}` } },
      );
      assert.equal(mismatchedScope.status, 409);
      // Collector-held shipping is manually coordinated; the old owner's private
      // delivery request cannot be reused for the new owner.
      await move("DISPATCH_FROM_COLLECTOR");
      await context.collectorDelivery.assertState(id, "IN_TRANSIT_B");
      await move("RECEIVE_BY_COLLECTOR");
      await context.collectorDelivery.assertState(id, "HELD_B");
      await visit(secondBuyer, `/collection/${id}/resale`);
      await expect(
        secondBuyer.getByText("This approval no longer applies", { exact: true }),
      ).toBeVisible();
      await inspect("POST_DELIVERY");
      await context.collectorDelivery.assertState(id, "POST_DELIVERY_B");
      const finalTag = await globalThis.fetch(`${context.apiOrigin}/nfc/${tagId}`, {
        redirect: "manual",
      });
      assert.equal(finalTag.headers.get("location"), resolved.headers.get("location"));
    }
    assert.deepEqual(errors, [], "Production browser errors");
  } catch (error) {
    error.message += `\nRequests: ${requests.join("\n")}`;
    // Text-only diagnostics contain public UI state, never wallet signatures,
    // session tokens or private evidence bytes.
    for (let i = 0; i < pages.length; i++)
      error.message += `\nActor ${i}: ${await pages[i]
        .locator("body")
        .innerText()
        .catch(() => "page unavailable")}`;
    throw error;
  } finally {
    await browser.close();
  }
}
