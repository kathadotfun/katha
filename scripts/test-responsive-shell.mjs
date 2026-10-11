import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

// Reuse the owned synthetic HTTP fixture; never navigate user services.
export async function runResponsiveShellChecks({ origin, apiOrigin }) {
  const browser = await chromium.launch();
  const artifacts = fileURLToPath(
    new URL("../helper/design/reports/design-handoff/", import.meta.url),
  );
  await mkdir(artifacts, { recursive: true });
  let scans = 0;
  try {
    for (const width of [320, 390, 640, 768, 1023, 1024, 1280, 1440]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      await context.route("**/*", (route) =>
        [origin, apiOrigin].includes(new URL(route.request().url()).origin)
          ? route.continue()
          : route.abort(),
      );
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      async function audit(label) {
        assert.ok(
          await page.evaluate(
            () =>
              globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
          ),
          `${label} overflows at ${width}px`,
        );
        const results = await new AxeBuilder({ page }).analyze();
        assert.deepEqual(
          results.violations.map((v) => ({
            id: v.id,
            targets: v.nodes.map((n) => n.target),
          })),
          [],
          `${label} at ${width}px`,
        );
        scans++;
      }
      await page.goto(origin);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const menu = page.locator(".menubtn");
      const nav = page.getByRole("navigation", { name: "Main", exact: true });
      // The public header collapses to a Menu button at 860px and below.
      if (width <= 860) {
        await expect(menu).toBeVisible();
        await expect(nav).toBeHidden();
        await page.keyboard.press("Tab");
        await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("main")).toBeFocused();
        await menu.focus();
        await page.keyboard.press("Enter");
        await expect(menu).toHaveAttribute("aria-expanded", "true");
        await expect(nav).toBeVisible();
        const bounds = await menu.boundingBox();
        assert.ok(bounds.width >= 44 && bounds.height >= 44);
        await page.keyboard.press("Tab");
        await expect(
          nav.getByRole("link", { name: "Artworks", exact: true }),
        ).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(menu).toBeFocused();
        await expect(nav).toBeHidden();
        await menu.click();
      } else {
        await expect(menu).toBeHidden();
        await expect(nav).toBeVisible();
      }
      await audit("open navigation");
      await nav.getByRole("link", { name: "Artworks", exact: true }).click();
      await expect(page).toHaveURL(`${origin}/explore`);
      if (width <= 860) await expect(nav).toBeHidden();
      await audit("catalogue shell");
      // Wallet selection lives on the account page as a native modal dialog.
      await page.goto(`${origin}/account`);
      await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
      const chooser = page.getByRole("dialog", { name: "Choose a wallet" });
      await expect(chooser).toContainText("No compatible Solana wallet found");
      await audit("wallet chooser");
      await page.keyboard.press("Escape");
      await expect(chooser).toBeHidden();
      await expect(
        page.getByRole("button", { name: "Connect wallet", exact: true }),
      ).toBeFocused();
      for (const path of [
        "/",
        "/art/KATHA-PAUBHA-000001",
        "/artists/synthetic-artist",
        "/account",
        "/collection",
        "/admin",
        "/admin/artworks/KATHA-PAUBHA-000001",
        "/not-a-page",
      ]) {
        await page.goto(`${origin}${path}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await audit(path);
      }
      await page.screenshot({ path: `${artifacts}/shell-${width}.png` });
      if (width === 320 || width === 1280) {
        await page.addStyleTag({ content: "html { font-size: 200%; }" });
        await audit("200 percent text");
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    const noScript = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 320, height: 900 },
    });
    const page = await noScript.newPage();
    await page.goto(origin);
    await expect(page.locator(".menubtn")).toBeHidden();
    await page
      .getByRole("navigation", { name: "Main", exact: true })
      .getByRole("link", { name: "Artworks", exact: true })
      .click();
    await expect(page).toHaveURL(`${origin}/explore`);
    assert.ok(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
    );
    await noScript.close();
    globalThis.console.log(
      `Responsive shell passed: 320/390/640/768/1023/1024/1280/1440px, ${scans} axe scans, keyboard/Escape, navigation closure, wallet chooser dialog, public/collector/operations/not-found shells, 200% text and no-JavaScript browsing. Screenshots remain private in helper/design/reports/design-handoff/.`,
    );
  } finally {
    await browser.close();
  }
}
