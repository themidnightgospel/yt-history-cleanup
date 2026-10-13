import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, "..", "dist");

const WATCH_URL = "https://www.youtube.com/watch?v=fixtureMain";
const HOME_URL = "https://www.youtube.com/";
const PLAYER = "#movie_player";
const GROUP = `${PLAYER} .ytp-right-controls .ythc-boost`;
const BTN = `${GROUP} .ythc-boost-btn`;
const MENU = `${GROUP} .ythc-boost-menu`;
const CHIP = `${MENU} .ythc-boost-chip`;
// youtube.com enforces Trusted Types. Serve the fixture the same way, so a
// string assigned to innerHTML (or any other sink) fails here as it does there.
const TRUSTED_TYPES_CSP = { "Content-Security-Policy": "require-trusted-types-for 'script'" };

let context: BrowserContext;
let page: Page;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      // Let the AudioContext start without a gesture, as the real click would.
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
});

test.afterAll(async () => {
  await context.close();
});

test.beforeEach(async () => {
  page = await context.newPage();
  const watch = await readFile(resolve(here, "fixtures", "watch.html"), "utf8");
  const home = await readFile(resolve(here, "fixtures", "home.html"), "utf8");
  await page.route("https://www.youtube.com/watch*", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", headers: TRUSTED_TYPES_CSP, body: watch }),
  );
  await page.route(HOME_URL, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: home }),
  );
});

test.afterEach(async () => {
  await page.close();
});

async function open(url = WATCH_URL): Promise<void> {
  await page.goto(url);
  await expect(page.locator(BTN)).toHaveCount(1, { timeout: 5000 });
}

test("one boost button sits left of the speed group, chips hidden until hover", async () => {
  await open();
  const next = await page.evaluate(
    () => document.querySelector(".ythc-boost")!.nextElementSibling!.className,
  );
  expect(next).toContain("ythc-speed-group");
  await expect(page.locator(MENU)).toBeHidden();
  await expect(page.locator(BTN)).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(PLAYER)).not.toHaveAttribute("data-ythc-boost", /.*/);

  await page.locator(BTN).hover();
  await expect(page.locator(MENU)).toBeVisible();
  await expect(page.locator(BTN)).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(CHIP)).toHaveText(["1.5×", "2×", "3×"]);
});

test("clicking a chip boosts, marks the button orange with the multiplier, and sets the player attribute", async () => {
  await open();
  await page.locator(BTN).hover();
  await page.locator(CHIP).nth(1).click();
  await expect(page.locator(PLAYER)).toHaveAttribute("data-ythc-boost", "2");
  await expect(page.locator(BTN)).toHaveClass(/ythc-boost-active/);
  await expect(page.locator(BTN)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`${BTN} .ythc-boost-mult`)).toHaveText("2×");
  await expect(page.locator(CHIP).nth(1)).toHaveClass(/ythc-boost-active/);
  await expect(page.locator(CHIP).nth(1)).toHaveAttribute("aria-checked", "true");

  await page.locator(CHIP).nth(2).click();
  await expect(page.locator(PLAYER)).toHaveAttribute("data-ythc-boost", "3");
  await expect(page.locator(CHIP).nth(1)).not.toHaveClass(/ythc-boost-active/);
});

test("clicking the active chip returns to 1×; the button toggles off and back to the last stop", async () => {
  await open();
  await page.locator(BTN).hover();
  await page.locator(CHIP).nth(2).click();
  await page.locator(CHIP).nth(2).click();
  await expect(page.locator(PLAYER)).not.toHaveAttribute("data-ythc-boost", /.*/);
  await expect(page.locator(BTN)).not.toHaveClass(/ythc-boost-active/);

  await page.locator(BTN).click();
  await expect(page.locator(PLAYER)).toHaveAttribute("data-ythc-boost", "3");
  await page.locator(BTN).click();
  await expect(page.locator(PLAYER)).not.toHaveAttribute("data-ythc-boost", /.*/);
});

test("a mouse click does not hold the chips open once the pointer leaves", async () => {
  await open();
  await page.locator(BTN).click();
  await expect(page.locator(PLAYER)).toHaveAttribute("data-ythc-boost", "2");
  await page.mouse.move(0, 0);
  await expect(page.locator(MENU)).toBeHidden();
  await expect(page.locator(BTN)).toHaveAttribute("aria-expanded", "false");
});

test("the chips open from the keyboard and close on Escape", async () => {
  await open();
  await page.locator(BTN).focus();
  await expect(page.locator(MENU)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator(CHIP).nth(0)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(PLAYER)).toHaveAttribute("data-ythc-boost", "1.5");
  await page.keyboard.press("Escape");
  await expect(page.locator(MENU)).toBeHidden();
});

test("the boost does not leak onto the next video after an SPA navigation", async () => {
  await open();
  await page.locator(BTN).hover();
  await page.locator(CHIP).nth(1).click();
  await expect(page.locator(PLAYER)).toHaveAttribute("data-ythc-boost", "2");
  // YouTube swaps videos in place: same document, same player, new v=.
  await page.evaluate(() => {
    history.pushState(null, "", "/watch?v=fixtureOther");
    window.dispatchEvent(new Event("yt-navigate-finish"));
  });
  await expect(page.locator(PLAYER)).not.toHaveAttribute("data-ythc-boost", /.*/);
  await expect(page.locator(BTN)).not.toHaveClass(/ythc-boost-active/);
  await expect(page.locator(BTN)).toHaveCount(1);
});

test("re-routing within the same video keeps the boost", async () => {
  await open();
  await page.locator(BTN).hover();
  await page.locator(CHIP).nth(0).click();
  await page.evaluate(() => window.dispatchEvent(new Event("yt-navigate-finish")));
  await expect(page.locator(PLAYER)).toHaveAttribute("data-ythc-boost", "1.5");
});

test("no boost button is injected on the home page", async () => {
  await page.goto(HOME_URL);
  await expect(page.locator(".ythc-grayscale-toggle")).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator(".ythc-boost")).toHaveCount(0);
});
