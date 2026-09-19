import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, "..", "dist");

const WATCH_URL = "https://www.youtube.com/watch?v=fixtureMain";
const HOME_URL = "https://www.youtube.com/";
const GROUP = "#movie_player .ytp-right-controls .ythc-speed-group";
const BTN = `${GROUP} .ythc-speed-btn`;

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
  const watch = await readFile(resolve(here, "fixtures", "watch.html"), "utf8");
  const home = await readFile(resolve(here, "fixtures", "home.html"), "utf8");
  await page.route("https://www.youtube.com/watch*", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: watch }),
  );
  await page.route(HOME_URL, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: home }),
  );
});

test.afterEach(async () => {
  await page.close();
});

function playbackRate(): Promise<number> {
  return page.evaluate(() => document.querySelector("video")!.playbackRate);
}

test("four speed buttons sit directly before the captions button", async () => {
  await page.goto(WATCH_URL);
  await expect(page.locator(BTN)).toHaveCount(4, { timeout: 5000 });
  await expect(page.locator(BTN)).toHaveText(["1.25×", "1.5×", "1.75×", "2×"]);
  const next = await page.evaluate(
    () => document.querySelector(".ythc-speed-group")!.nextElementSibling!.className,
  );
  expect(next).toContain("ytp-subtitles-button");
});

test("clicking a speed changes the video's playback rate and highlights the button", async () => {
  await page.goto(WATCH_URL);
  await expect(page.locator(BTN)).toHaveCount(4, { timeout: 5000 });
  expect(await playbackRate()).toBe(1);

  await page.locator(BTN).nth(1).click();
  expect(await playbackRate()).toBe(1.5);
  await expect(page.locator(BTN).nth(1)).toHaveClass(/ythc-speed-active/);
  await expect(page.locator(BTN).nth(1)).toHaveAttribute("aria-pressed", "true");

  await page.locator(BTN).nth(3).click();
  expect(await playbackRate()).toBe(2);
  await expect(page.locator(BTN).nth(1)).not.toHaveClass(/ythc-speed-active/);
  await expect(page.locator(BTN).nth(3)).toHaveClass(/ythc-speed-active/);
});

test("clicking the active speed returns to normal speed", async () => {
  await page.goto(WATCH_URL);
  await expect(page.locator(BTN)).toHaveCount(4, { timeout: 5000 });
  await page.locator(BTN).nth(2).click();
  expect(await playbackRate()).toBe(1.75);
  await page.locator(BTN).nth(2).click();
  expect(await playbackRate()).toBe(1);
  await expect(page.locator(`${BTN}.ythc-speed-active`)).toHaveCount(0);
});

test("a rate change made elsewhere (gear menu, shortcut) updates the highlight", async () => {
  await page.goto(WATCH_URL);
  await expect(page.locator(BTN)).toHaveCount(4, { timeout: 5000 });
  await page.evaluate(() => {
    (document.getElementById("movie_player") as unknown as { setPlaybackRate(r: number): void })
      .setPlaybackRate(1.25);
  });
  await expect(page.locator(BTN).nth(0)).toHaveClass(/ythc-speed-active/);
});

test("no speed buttons are injected on the home page", async () => {
  await page.goto(HOME_URL);
  await expect(page.locator(".ythc-grayscale-toggle")).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator(".ythc-speed-group")).toHaveCount(0);
});
