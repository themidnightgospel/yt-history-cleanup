import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, "..", "dist");

const HOME_URL = "https://www.youtube.com/";
const WATCH_URL = "https://www.youtube.com/watch?v=fixtureMain";
const TOGGLE = ".ythc-grayscale-toggle";

let context: BrowserContext;
let page: Page;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
});

test.afterAll(async () => {
  await context.close();
});

test.beforeEach(async () => {
  page = await context.newPage();
  const home = await readFile(resolve(here, "fixtures", "home.html"), "utf8");
  const watch = await readFile(resolve(here, "fixtures", "watch.html"), "utf8");
  await page.route(HOME_URL, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: home }),
  );
  await page.route("https://www.youtube.com/watch*", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: watch }),
  );
  // Each test starts from the default (never toggled) state.
  await page.goto(HOME_URL);
  await page.evaluate(() => localStorage.removeItem("ythc-grayscale"));
});

test.afterEach(async () => {
  await page.close();
});

function filterOf(selector: string): Promise<string> {
  return page.evaluate(
    (sel) => getComputedStyle(document.querySelector(sel)!).filter,
    selector,
  );
}

test("home thumbnails are grayscale by default and the masthead shows the toggle on", async () => {
  await page.goto(HOME_URL);
  await expect(page.locator(TOGGLE)).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-ythc-grayscale", "1");
  await expect.poll(() => filterOf("#thumb-1")).toBe("grayscale(1)");
});

test("hovering a home card brings its thumbnail back to color", async () => {
  await page.goto(HOME_URL);
  await expect(page.locator(TOGGLE)).toHaveCount(1, { timeout: 5000 });
  await expect.poll(() => filterOf("#thumb-1")).toBe("grayscale(1)");
  await page.locator("#card-1").hover();
  await expect.poll(() => filterOf("#thumb-1")).toBe("none");
  await page.mouse.move(0, 0);
  await expect.poll(() => filterOf("#thumb-1")).toBe("grayscale(1)");
});

test("keyboard focus inside a card also lifts the filter", async () => {
  await page.goto(HOME_URL);
  await expect(page.locator(TOGGLE)).toHaveCount(1, { timeout: 5000 });
  await expect.poll(() => filterOf("#thumb-1")).toBe("grayscale(1)");
  await page.locator("#card-1 a").focus();
  await expect.poll(() => filterOf("#thumb-1")).toBe("none");
});

test("channel avatars on home cards are grayscale and lift on hover with the card", async () => {
  await page.goto(HOME_URL);
  await expect(page.locator(TOGGLE)).toHaveCount(1, { timeout: 5000 });
  await expect.poll(() => filterOf("#avatar-1")).toBe("grayscale(1)");
  await page.locator("#card-1").hover();
  await expect.poll(() => filterOf("#avatar-1")).toBe("none");
});

test("watch-page sidebar thumbnails are grayscale, the main player area is not", async () => {
  await page.goto(WATCH_URL);
  await expect(page.locator(TOGGLE)).toHaveCount(1, { timeout: 5000 });
  await expect.poll(() => filterOf("#related-thumb")).toBe("grayscale(1)");
  await expect.poll(() => filterOf("#primary-thumb")).toBe("none");
});

test("the toggle turns grayscale off, persists across reload, and turns it back on", async () => {
  await page.goto(HOME_URL);
  await expect(page.locator(TOGGLE)).toHaveCount(1, { timeout: 5000 });

  await page.locator(TOGGLE).click();
  await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("html")).not.toHaveAttribute("data-ythc-grayscale", "1");
  await expect.poll(() => filterOf("#thumb-1")).toBe("none");

  await page.reload();
  await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "false", { timeout: 5000 });
  await expect.poll(() => filterOf("#thumb-1")).toBe("none");

  await page.locator(TOGGLE).click();
  await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => filterOf("#thumb-1")).toBe("grayscale(1)");
});

test("the setting carries over to the watch page", async () => {
  await page.goto(HOME_URL);
  await expect(page.locator(TOGGLE)).toHaveCount(1, { timeout: 5000 });
  await page.locator(TOGGLE).click();

  await page.goto(WATCH_URL);
  await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "false", { timeout: 5000 });
  await expect.poll(() => filterOf("#related-thumb")).toBe("none");
});
