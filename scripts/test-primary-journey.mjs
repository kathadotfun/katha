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
              signTransaction: async (...inputs) =>
                Promise.all(
                  inputs.map(async (input) => ({
                    signedTransaction: Uint8Array.from(
                      await globalThis.kathaTestSignTransaction([...input.transaction]),
                    ),
                  })),
                ),
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
      await page.goto(`${context.origin}${path}`);
      await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
      const panel = page.getByRole("region", { name: "Your Solana wallet" });
      await panel
        .getByRole("button", { name: "Connect Primary journey wallet", exact: true })
        .click();
      await panel
        .getByRole("button", { name: "Sign in to Katha", exact: true })
        .click();
      await expect(
        panel.getByText("Signed in to Katha", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Wallet connected", exact: true }).click();
    }
    async function postResult(page, path, action) {
      const pending = page.waitForResponse(
        (r) =>
          r.url() === `${context.apiOrigin}${path}` && r.request().method() === "POST",
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
        name: "Approve in wallet and submit",
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
          name: "Check this transaction again",
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
      buyer.getByText(/no applicable administration permission/i).first(),
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
    for (const [label, value] of [
      ["Artist display name", "Synthetic Nepali artist"],
      ["Public profile slug", `primary-${randomUUID()}`],
      ["Biography", "Fictional Paubha artist for local browser verification."],
      ["Region", "Patan"],
      ["Art traditions (one per line)", "Paubha"],
      ["Payout wallet (optional)", context.actors[3].address],
    ])
      await admin.getByLabel(label, { exact: true }).fill(value);
    const artist = await postResult(admin, "/admin/artists", () =>
      admin.getByRole("button", { name: "Create artist profile", exact: true }).click(),
    );
    await visit(verifier, "/admin");
    await verifier.getByLabel("Artist UUID", { exact: true }).fill(artist.id);
    await verifier
      .getByRole("button", { name: "Load artist profile", exact: true })
      .click();
    await verifier
      .getByRole("checkbox", { name: /I completed manual artist verification/ })
      .check();
    await postResult(verifier, `/verifier/artists/${artist.id}/verification`, () =>
      verifier
        .getByRole("button", { name: "Record artist verification", exact: true })
        .click(),
    );
    await visit(admin, "/admin/artworks/new");
    for (const [name, value] of Object.entries({
      artistId: artist.id,
      category: "PAUBHA",
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
    const draft = await postResult(admin, "/admin/artworks", () =>
      admin.getByRole("button", { name: "Create artwork draft", exact: true }).click(),
    );
    const id = draft.kathaId;
    assert.ok(id);
    await visit(admin, `/admin/artworks/${id}/media`);
    await admin
      .locator('[name="file"]')
      .setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: png });
    await admin.locator('[name="role"]').selectOption("HERO");
    await admin.locator('[name="visibility"]').selectOption("PUBLIC");
    await admin.locator('[name="approvedPublic"]').check();
    await admin.locator('[name="altText"]').fill("Synthetic Paubha test image");
    await admin
      .getByRole("button", { name: "Upload artwork file", exact: true })
      .click();
    await expect(admin.getByText(/Artwork media saved\./)).toBeVisible();
    await visit(admin, `/admin/artworks/${id}/registration`);
    await admin
      .getByRole("button", { name: "Prepare canonical metadata", exact: true })
      .click();
    await admin
      .getByRole("checkbox", { name: /I reviewed the permanent identity/ })
      .check();
    await transact(admin, "Prepare and simulate registration");
    await visit(verifier, `/admin/artworks/${id}/verification`);
    await verifier
      .getByLabel("Reviewed evidence SHA-256", { exact: true })
      .fill(evidence);
    await verifier
      .getByRole("checkbox", { name: /I physically inspected this artwork/ })
      .check();
    await verifier
      .getByRole("checkbox", { name: /I reviewed the artist attribution/ })
      .check();
    await transact(verifier, "Prepare and simulate verification");
    await visit(verifier, `/admin/artworks/${id}/condition`);
    await verifier.getByLabel("Inspection image", { exact: true }).setInputFiles({
      name: "private.png",
      mimeType: "image/png",
      buffer: privatePng,
    });
    await verifier
      .getByRole("button", { name: "Upload private evidence", exact: true })
      .click();
    await verifier.getByRole("checkbox", { name: /Evidence 1/ }).check();
    const privateHash = createHash("sha256").update(privatePng).digest("hex");
    assert.equal(
      (await globalThis.fetch(`${context.apiOrigin}/storage/public/${privateHash}.png`))
        .status,
      404,
    );
    await verifier
      .getByLabel("Inspector record UUID", { exact: true })
      .fill(randomUUID());
    await verifier
      .getByLabel("Actual inspection date and time (your local timezone)", {
        exact: true,
      })
      .fill(new Date(Date.now() - 60000).toISOString().slice(0, 19));
    await verifier
      .getByLabel("Private condition notes", { exact: true })
      .fill("Synthetic private inspection notes");
    await verifier
      .getByRole("checkbox", {
        name: /I physically inspected this artwork and approve these notes/,
      })
      .check();
    await verifier
      .getByRole("button", { name: "Save private condition report", exact: true })
      .click();
    await verifier
      .getByRole("checkbox", { name: /I reviewed the exact saved report/ })
      .check();
    await transact(verifier, "Prepare and simulate condition attestation");
    await visit(admin, `/admin/artworks/${id}/custody`);
    await admin
      .getByLabel("Physical movement", { exact: true })
      .selectOption("ATTEST_KATHA_CUSTODY");
    await admin
      .getByRole("checkbox", { name: /I confirmed that this physical movement/ })
      .check();
    await transact(admin, "Prepare custody attestation");
    await visit(admin, `/admin/artworks/${id}/metadata`);
    await admin
      .getByRole("checkbox", {
        name: /I reviewed the saved document and commitment change/,
      })
      .check();
    await transact(admin, "Prepare metadata revision");
    await visit(admin, `/admin/artworks/${id}/minting`);
    await admin
      .getByRole("checkbox", { name: /I reviewed the public metadata/ })
      .check();
    await transact(admin, "Prepare Core mint");
    await admin
      .getByRole("button", { name: "Reload saved state", exact: true })
      .click();
    await admin
      .getByRole("checkbox", { name: /I reviewed the finalized asset/ })
      .check();
    await admin.getByRole("button", { name: "Publish artwork", exact: true }).click();
    await expect(
      admin.getByRole("link", { name: "View published artwork", exact: true }),
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
    await admin.getByLabel("Price in test tokens", { exact: true }).fill("1");
    await admin
      .getByLabel("Listing expiry (your local time)", { exact: true })
      .fill(new Date(Date.now() + 3600000).toISOString().slice(0, 16));
    await transact(
      admin,
      "Prepare listing for review",
      "Transaction finalized and active listing observed",
    );
    // Resolve the canonical path against the local server: this test never
    // navigates to a hosted domain or writes a physical NFC tag.
    await visit(buyer, new URL(resolved.headers.get("location")).pathname);
    await expect(
      buyer.getByRole("heading", { name: "Synthetic Patan Paubha", exact: true }),
    ).toBeVisible();
    await buyer
      .getByRole("link", { name: "Review purchase quote", exact: true })
      .click();
    await buyer
      .getByRole("button", { name: "Refresh purchase quote", exact: true })
      .click();
    await transact(
      buyer,
      "Prepare reviewed purchase",
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
    await buyer
      .getByRole("button", { name: "Refresh collection", exact: true })
      .click();
    await expect(
      buyer.getByText("Synthetic Patan Paubha", { exact: true }),
    ).toBeVisible();
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
        admin.getByRole("button", { name: "Prepare listing for review", exact: true }),
      ).toBeDisabled();
      assert.equal(
        (await post(`/artworks/${id}/operations/listing`, 0, listingRequest)).status,
        403,
      );

      await visit(buyer, `/collection/${id}/list`);
      await buyer
        .getByRole("button", { name: "Refresh listing state", exact: true })
        .click();
      await expect(buyer.getByText(/Inspection approval: not_required/)).toBeVisible();
      await buyer.getByLabel("Price in test tokens", { exact: true }).fill("2");
      await buyer
        .getByLabel("Listing expiry (your local time)", { exact: true })
        .fill(new Date(Date.now() + 3600000).toISOString().slice(0, 16));
      await transact(
        buyer,
        "Prepare listing for review",
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
        .getByRole("link", { name: "Review purchase quote", exact: true })
        .click();
      const quote = await postResult(
        secondBuyer,
        `/artworks/${id}/purchase-quote`,
        () =>
          secondBuyer
            .getByRole("button", { name: "Refresh purchase quote", exact: true })
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
        secondBuyer.getByText("Total: 2.000000 test tokens", { exact: true }),
      ).toBeVisible();
      await transact(
        secondBuyer,
        "Prepare reviewed purchase",
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
      await buyer
        .getByRole("button", { name: "Refresh collection", exact: true })
        .click();
      await expect(
        buyer.getByText("No published artworks are indexed to this wallet yet", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        buyer.getByText("Synthetic Patan Paubha", { exact: true }),
      ).toHaveCount(0);
      await visit(secondBuyer, "/collection");
      await secondBuyer
        .getByRole("button", { name: "Refresh collection", exact: true })
        .click();
      await expect(
        secondBuyer.getByText("Synthetic Patan Paubha", { exact: true }),
      ).toBeVisible();
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
