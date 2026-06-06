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

test("decorates a shelf short with a delete button", async () => {
  await page.goto("https://www.youtube.com/feed/history");
  const btn = page.locator("#short-1 .ythc-delete-btn");
  await expect(btn).toHaveCount(1, { timeout: 5000 });
});

test("clicking the shelf short delete button posts its feedbackToken", async () => {
  let feedbackBody: string | null = null;
  await page.route("https://www.youtube.com/youtubei/v1/feedback*", async (route, request) => {
    feedbackBody = request.postData();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ feedbackResponses: [{ isProcessed: true }] }),
    });
  });

  await page.goto("https://www.youtube.com/feed/history");
  const responsePromise = page.waitForResponse((r) =>
    r.url().includes("/youtubei/v1/feedback"),
  );
  await page.locator("#short-1 .ythc-delete-btn").click();
  await responsePromise;

  expect(feedbackBody).toContain("FIXTURE_TOKEN_SHORT");
  await expect(page.locator("#short-1")).toHaveCount(0);
});

test("channel-delete button appears in the video row's metadata row", async () => {
  await page.goto("https://www.youtube.com/feed/history");
  const btn = page.locator("#row-1 .ythc-channel-delete-btn");
  await expect(btn).toHaveCount(1, { timeout: 5000 });
});

test("channel-delete dialog opens with channel name and closes on cancel", async () => {
  await page.goto("https://www.youtube.com/feed/history");
  await page.locator("#row-1 .ythc-channel-delete-btn").click();
  const dialog = page.locator("dialog.ythc-channel-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".ythc-channel-dialog-title")).toContainText(
    "Fixture Channel",
  );

  const cancelBtn = dialog
    .locator(
      ".ythc-channel-dialog-form .ythc-channel-dialog-btn:not(.ythc-channel-dialog-btn-danger)",
    )
    .first();
  await cancelBtn.click();
  await expect(dialog).toHaveCount(0);
});

test("shelf delete-all button empties a single-page shelf and posts each token", async () => {
  const posted: string[] = [];
  await page.route("https://www.youtube.com/youtubei/v1/feedback*", async (route, request) => {
    const body = request.postData();
    if (body) posted.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ feedbackResponses: [{ isProcessed: true }] }),
    });
  });

  await page.goto("https://www.youtube.com/feed/history");
  const shelfBtn = page.locator("#shelf-bulk .ythc-shelf-delete-btn");
  await expect(shelfBtn).toHaveCount(1, { timeout: 5000 });
  await shelfBtn.click();

  await page.waitForFunction(
    () => document.querySelectorAll("#shelf-bulk ytm-shorts-lockup-view-model").length === 0,
    null,
    { timeout: 5000 },
  );

  expect(posted.some((b) => b.includes("FIXTURE_TOKEN_SHELF_A"))).toBe(true);
  expect(posted.some((b) => b.includes("FIXTURE_TOKEN_SHELF_B"))).toBe(true);
});

test("clicking the delete button issues a POST to /youtubei/v1/feedback", async () => {
  let feedbackBody: string | null = null;
  await page.route("https://www.youtube.com/youtubei/v1/feedback*", async (route, request) => {
    feedbackBody = request.postData();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ feedbackResponses: [{ isProcessed: true }] }),
    });
  });

  await page.goto("https://www.youtube.com/feed/history");
  const responsePromise = page.waitForResponse((r) =>
    r.url().includes("/youtubei/v1/feedback"),
  );
  await page.locator("yt-lockup-view-model .ythc-delete-btn").click();
  await responsePromise;

  expect(feedbackBody).toContain("FIXTURE_TOKEN_1");
  await expect(page.locator("#row-1")).toHaveCount(0);
});
