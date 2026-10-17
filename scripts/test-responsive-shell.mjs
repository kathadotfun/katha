import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

export async function runScrollChecks({ origin }) {
  const browser = await chromium.launch();
  const artifacts = fileURLToPath(
    new URL("../helper/design/reports/design-v2/", import.meta.url),
  );
  await mkdir(artifacts, { recursive: true });
  try {
    for (const { width, reducedMotion } of [390, 1440].flatMap((width) =>
      ["reduce", "no-preference"].map((reducedMotion) => ({ width, reducedMotion })),
    )) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        isMobile: width === 390,
        hasTouch: width === 390,
        reducedMotion,
      });
      const page = await context.newPage();
      for (const theme of ["dark", "light"]) {
        globalThis.console.log(`Scroll check: ${width}px, ${reducedMotion}, ${theme}`);
        await page.goto(origin);
        if (theme === "light")
          await page.getByRole("button", { name: "Dark theme", exact: true }).click();
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const header = page.locator(".hdr");
        await expect(header).toHaveAttribute("data-scroll-hidden", "false");
        assert.ok(
          await page.evaluate(
            () =>
              globalThis.document.documentElement.scrollHeight > globalThis.innerHeight,
          ),
          "The landing page must have content below the viewport",
        );
        if (width === 390) {
          const session = await context.newCDPSession(page);
          await session.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x: 195, y: 750 }],
          });
          for (let y = 700; y >= 250; y -= 50)
            await session.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x: 195, y }],
            });
          await session.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          await session.detach();
        } else {
          await page.mouse.move(720, 700);
          const firstScroll = page.evaluate(
            () =>
              new Promise((resolve) =>
                globalThis.addEventListener(
                  "scroll",
                  () => resolve(globalThis.scrollY),
                  {
                    once: true,
                  },
                ),
              ),
          );
          await page.mouse.wheel(0, 600);
          const firstPosition = await firstScroll;
          if (reducedMotion === "no-preference")
            assert.ok(
              firstPosition > 0 && firstPosition < 600,
              "Wheel movement must ease through intermediate positions",
            );
          await expect.poll(() => page.evaluate(() => globalThis.scrollY)).toBe(600);
        }
        await expect
          .poll(() => page.evaluate(() => globalThis.scrollY), {
            message: `${theme} home must scroll with ${width === 390 ? "a touch swipe" : "the mouse wheel"}`,
          })
          .toBeGreaterThan(100);
        await page.getByRole("main").focus();
        const before = await page.evaluate(() => globalThis.scrollY);
        await page.keyboard.press("PageDown");
        await expect
          .poll(() => page.evaluate(() => globalThis.scrollY))
          .toBeGreaterThan(before);
        await page.keyboard.press("Control+End");
        await expect(page.getByRole("contentinfo")).toBeInViewport();
        const back = page.getByRole("button", { name: "Back to top", exact: true });
        await expect(back).toBeVisible();
        const buttonBounds = await back.boundingBox();
        assert.ok(buttonBounds.width >= 120 && buttonBounds.height >= 44);
        assert.ok(buttonBounds.x + buttonBounds.width <= width - 20);
        assert.ok(buttonBounds.y + buttonBounds.height <= 880);
        await page.mouse.move(width / 2, 600);
        await expect(header).toHaveAttribute("data-scroll-hidden", "true");
        await page.mouse.wheel(0, -240);
        await expect(header).toHaveAttribute("data-scroll-hidden", "false");
        await expect(header).toBeInViewport();
        await expect
          .poll(async () => Math.round((await header.boundingBox()).y))
          .toBe(0);
        if (theme === "dark" && reducedMotion === "no-preference")
          await page.screenshot({ path: `${artifacts}/scroll-controls-${width}.png` });
        await expect(header).toHaveAttribute("data-scroll-hidden", "true", {
          timeout: 3000,
        });
        if (width === 390) {
          await page.keyboard.press("PageUp");
          await expect(header).toHaveAttribute("data-scroll-hidden", "false");
          await header.getByRole("button", { name: "Menu", exact: true }).click();
          await page.waitForTimeout(1200);
          await expect(page.locator("#mobile-navigation")).toBeVisible();
          await expect(header).toBeInViewport();
          await page.keyboard.press("Escape");
        }
        await back.click();
        await expect.poll(() => page.evaluate(() => globalThis.scrollY)).toBe(0);
        await expect(header).toHaveAttribute("data-scroll-hidden", "false");
        await expect(back).toBeHidden();
        await expect(page.getByRole("main")).toBeFocused();
        if (width === 390) {
          await header.getByRole("button", { name: "Menu", exact: true }).click();
          await page.locator('#mobile-navigation a[href="#how"]').click();
        } else {
          await header.getByRole("link", { name: "How it works", exact: true }).click();
        }
        await expect(page).toHaveURL(`${origin}/#how`);
        await expect(page.locator("#how-title")).toBeInViewport();
        assert.ok(
          (await page.locator("#how-title").boundingBox()).y >= 72,
          "Anchor headings must clear the sticky navbar",
        );
        assert.ok(
          await page.evaluate(
            () =>
              globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
          ),
          `${theme} home must not overflow horizontally at ${width}px`,
        );
      }
      await context.close();
    }
    globalThis.console.log(
      "Landing scroll passed: eased wheel, native touch/keyboard, navbar direction/idle/menu behavior and Back to top placement/focus at 390/1440px in both themes and motion preferences; no horizontal overflow.",
    );
  } finally {
    await browser.close();
  }
}

// Owned synthetic services only; never navigate an operator's running services.
export async function runResponsiveShellChecks({ origin, apiOrigin }) {
  await runScrollChecks({ origin });
  const browser = await chromium.launch();
  const artifacts = fileURLToPath(
    new URL("../helper/design/reports/design-v2/", import.meta.url),
  );
  await mkdir(artifacts, { recursive: true });
  let scans = 0;
  try {
    for (const width of [320, 390, 640, 768, 900, 1024, 1280, 1440]) {
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
      const mobile = page.locator("#mobile-navigation");
      const nav = page.getByRole("navigation", { name: "Main", exact: true });
      if (width <= 900) {
        await expect(menu).toBeVisible();
        await expect(nav).toBeHidden();
        await page.keyboard.press("Tab");
        await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("main")).toBeFocused();
        await menu.focus();
        await page.keyboard.press("Enter");
        await expect(menu).toHaveAttribute("aria-expanded", "true");
        await expect(mobile).toBeVisible();
        const bounds = await menu.boundingBox();
        assert.ok(bounds.width >= 44 && bounds.height >= 44);
        await page.keyboard.press("Tab");
        await expect(
          mobile.getByRole("link", { name: "Artworks", exact: true }),
        ).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(menu).toBeFocused();
        await expect(mobile).toBeHidden();
      } else {
        await expect(menu).toBeHidden();
        await expect(nav).toBeVisible();
      }
      await audit("public navigation");
      const theme = page.getByRole("button", { name: "Dark theme", exact: true });
      await expect(theme).toHaveAttribute("aria-pressed", "true");
      await theme.click();
      await expect(theme).toHaveAttribute("aria-pressed", "false");
      await audit("light home");
      if ([390, 1440].includes(width))
        await page.screenshot({
          path: `${artifacts}/home-light-${width}.png`,
          fullPage: true,
        });
      await page
        .getByRole("main")
        .getByRole("link", { name: "Explore artworks", exact: true })
        .first()
        .click();
      await expect(page).toHaveURL(`${origin}/explore`);
      await expect(theme).toHaveAttribute("aria-pressed", "false");
      await page.reload();
      await expect(theme).toHaveAttribute("aria-pressed", "false");
      await audit("light catalogue, persisted theme");
      if (width <= 900) await expect(mobile).toBeHidden();
      await theme.click();
      await expect(theme).toHaveAttribute("aria-pressed", "true");
      for (const path of [
        "/",
        "/art/KATHA-PAUBHA-000001",
        "/artists/synthetic-artist",
        "/account",
        "/collection",
        "/admin",
        "/admin/artworks/new",
        "/admin/artworks/KATHA-PAUBHA-000001",
        "/admin/devnet",
        "/tags/bbbbbbbb-1111-4111-8111-111111111111",
        "/not-a-page",
      ]) {
        await page.goto(`${origin}${path}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await audit(`dark ${path}`);
        if ([390, 1440].includes(width))
          await page.screenshot({
            path: `${artifacts}/dark-${width}-${path.replaceAll(/[^a-zA-Z0-9]/g, "_") || "home"}.png`,
            fullPage: true,
          });
        await theme.click();
        await audit(`light ${path}`);
        if ([390, 1440].includes(width) && path !== "/")
          await page.screenshot({
            path: `${artifacts}/light-${width}-${path.replaceAll(/[^a-zA-Z0-9]/g, "_")}.png`,
            fullPage: true,
          });
        await theme.click();
      }
      await page.goto(`${origin}/account`);
      await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
      const chooser = page.getByRole("dialog", { name: "Choose a wallet" });
      await expect(chooser).toContainText("No compatible Solana wallet found");
      await audit("wallet dialog");
      await page.keyboard.press("Escape");
      await expect(chooser).toBeHidden();
      await expect(
        page.getByRole("button", { name: "Connect wallet", exact: true }),
      ).toBeFocused();
      if (width <= 900) {
        await menu.click();
        await audit("dashboard menu");
        await mobile.getByRole("link", { name: "My collection", exact: true }).click();
        await expect(page).toHaveURL(`${origin}/collection`);
        await expect(
          page.getByRole("heading", { name: "My collection", exact: true }),
        ).toBeVisible();
        await expect(mobile).toBeHidden();
      } else await expect(page.locator(".side")).toBeVisible();
      if ([320, 1280].includes(width)) {
        await page.addStyleTag({ content: "html {font-size:200%}" });
        await audit("200 percent text");
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    await runNoScriptChecks({ origin }, browser);
    globalThis.console.log(
      `Design v2 shell passed: 8 widths, ${scans} axe scans, both themes/persistence, keyboard/Escape, navigation, wallet dialog, public/collector/operations/NFC/error pages, 200% text, no-JavaScript browsing. Screenshots: helper/design/reports/design-v2/.`,
    );
  } finally {
    await browser.close();
  }
}

export async function runNoScriptChecks({ origin }, existingBrowser) {
  const browser = existingBrowser ?? (await chromium.launch());
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 900 },
  });
  try {
    const page = await context.newPage();
    await page.goto(origin);
    await expect(page.locator(".menubtn")).toBeHidden();
    await page.locator('#mobile-navigation a[href="/explore"]').click();
    await expect(page).toHaveURL(`${origin}/explore`);
    assert.ok(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
    );
    await page.goto(`${origin}/account`);
    await page
      .locator("#mobile-navigation")
      .getByRole("link", { name: "My collection", exact: true })
      .click();
    await expect(page).toHaveURL(`${origin}/collection`);
    globalThis.console.log(
      "Native public and collector navigation works without JavaScript.",
    );
  } finally {
    await context.close();
    if (!existingBrowser) await browser.close();
  }
}
