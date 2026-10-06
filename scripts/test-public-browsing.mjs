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
        await expect(page.getByText(message, { exact: false })).toBeVisible();
        await audit(`home ${mode}`);
      }
      setHomeMode("READY");
      await page.route("**/storage/public/*.png", (route) => route.abort());
      await page.goto(`${origin}/art/KATHA-PAUBHA-000001`);
      await expect(
        page.getByText("This photograph is unavailable.").first(),
      ).toBeVisible();
      await audit("failed photography");
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
