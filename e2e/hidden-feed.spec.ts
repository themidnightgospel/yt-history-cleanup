import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, "..", "dist");

const HOME_URL = "https://www.youtube.com/";
const TOGGLE = ".ythc-feed-toggle";
const PROMPT = ".ythc-feed-prompt";
const GRID = "ytd-rich-grid-renderer";

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
  await page.route(HOME_URL, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: home }),
  );
  await page.route("https://www.youtube.com/results*", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>results</title>" }),
  );
  await page.goto(HOME_URL);
  await page.evaluate(() => localStorage.removeItem("ythc-feed-shown-until"));
});

test.afterEach(async () => {
  await page.close();
});

test("the home feed is hidden by default, with the prompt in its place", async () => {
  await page.goto(HOME_URL);
  await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "true", { timeout: 5000 });
  await expect(page.locator(GRID)).toBeHidden();
  await expect(page.locator(PROMPT)).toBeVisible();
  await expect(page.locator(`${PROMPT} h2`)).toHaveText("What did you come here for?");
});

test("the button shows the feed as a countdown pill, and hides it again", async () => {
  await page.goto(HOME_URL);
  await page.locator(TOGGLE).click();
  await expect(page.locator(GRID)).toBeVisible();
  await expect(page.locator(PROMPT)).toBeHidden();
  await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(TOGGLE)).toHaveText(/^[01]:\d\d$/);
  await page.locator(TOGGLE).click();
  await expect(page.locator(GRID)).toBeHidden();
  await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "true");
});

test("the feed hides itself when the minute is up", async () => {
  await page.clock.install();
  await page.goto(HOME_URL);
  await page.locator(TOGGLE).click();
  await expect(page.locator(GRID)).toBeVisible();
  await page.clock.fastForward(61_000);
  await expect(page.locator(GRID)).toBeHidden();
  await expect(page.locator(".ythc-toast")).toContainText("hidden again");
});

test("a reload does not give a fresh minute", async () => {
  await page.goto(HOME_URL);
  await page.evaluate(() =>
    localStorage.setItem("ythc-feed-shown-until", String(Date.now() + 20_000)),
  );
  await page.reload();
  await expect(page.locator(GRID)).toBeVisible({ timeout: 5000 });
  await expect(page.locator(TOGGLE)).toHaveText(/^0:(1\d|20)$/);
});

test("the prompt searches YouTube for the answer", async () => {
  await page.goto(HOME_URL);
  await page.locator(`${PROMPT} input`).fill("sourdough starter");
  await page.locator(`${PROMPT} input`).press("Enter");
  await page.waitForURL("**/results?search_query=sourdough%20starter");
});

test.describe("watch page", () => {
  const WATCH_URL = "https://www.youtube.com/watch?v=fixtureMain";
  const UPNEXT = "ytd-watch-next-secondary-results-renderer";
  const NOTE = ".ythc-upnext-note";

  test.beforeEach(async () => {
    const watch = await readFile(resolve(here, "fixtures", "watch.html"), "utf8");
    await page.route("https://www.youtube.com/watch*", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: watch }),
    );
  });

  test("Up next is hidden, with a note in its place", async () => {
    await page.goto(WATCH_URL);
    await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "true", { timeout: 5000 });
    await expect(page.locator(UPNEXT)).toBeHidden();
    await expect(page.locator(NOTE)).toBeVisible();
  });

  test("the same button and peek show Up next", async () => {
    await page.goto(WATCH_URL);
    await page.locator(TOGGLE).click();
    await expect(page.locator(UPNEXT)).toBeVisible();
    await expect(page.locator(NOTE)).toBeHidden();
    await expect(page.locator(TOGGLE)).toHaveText(/^[01]:\d\d$/);
  });

  test("a peek started on the home page carries over to the watch page", async () => {
    await page.goto(HOME_URL);
    await page.locator(TOGGLE).click();
    await page.goto(WATCH_URL);
    await expect(page.locator(UPNEXT)).toBeVisible({ timeout: 5000 });
  });
});
