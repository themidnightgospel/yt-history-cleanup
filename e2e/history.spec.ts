import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, "..", "dist");
const fixtureHtmlPath = resolve(here, "fixtures", "history.html");

let context: BrowserContext;
let page: Page;

test.beforeAll(async () => {
  // Chromium extensions don't load under headless mode; run headed.
  // In CI use xvfb-run to drive a virtual display.
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
  const html = await readFile(fixtureHtmlPath, "utf8");
  await page.route("https://www.youtube.com/feed/history*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: html,
    });
  });
});

test.afterEach(async () => {
  await page.close();
});

test("decorates a history row with a delete button", async () => {
  await page.goto("https://www.youtube.com/feed/history");
  const btn = page.locator("yt-lockup-view-model .ythc-delete-btn");
  await expect(btn).toHaveCount(1, { timeout: 5000 });
  await expect(btn).toHaveAttribute("aria-label", "Delete from history");
});

test("clicking the delete button issues a POST to /youtubei/v1/feedback", async () => {
  let feedbackHit = false;
  let feedbackBody: string | null = null;
  await page.route("https://www.youtube.com/youtubei/v1/feedback*", async (route, request) => {
    feedbackHit = true;
    feedbackBody = request.postData();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ feedbackResponses: [{ isProcessed: true }] }),
    });
  });

  await page.goto("https://www.youtube.com/feed/history");
  await page.locator("yt-lockup-view-model .ythc-delete-btn").click();
  await page.waitForTimeout(500);

  expect(feedbackHit).toBe(true);
  expect(feedbackBody).toContain("FIXTURE_TOKEN_1");
  await expect(page.locator("#row-1")).toHaveCount(0);
});
