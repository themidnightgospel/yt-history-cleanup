import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, "..", "dist");
const fixtureHtmlPath = resolve(here, "fixtures", "home.html");

const HOME_URL = "https://www.youtube.com/";
const FEEDBACK_URL = "https://www.youtube.com/youtubei/v1/feedback*";

const undoResponse = {
  feedbackResponses: [{ isProcessed: true }],
  actions: [
    {
      replaceEnclosingAction: {
        item: {
          notificationMultiActionRenderer: {
            buttons: [
              {
                buttonRenderer: {
                  text: { runs: [{ text: "Tell us why" }] },
                  serviceEndpoint: { feedbackEndpoint: { feedbackToken: "FIXTURE_SURVEY" } },
                },
              },
              {
                buttonRenderer: {
                  text: { runs: [{ text: "Undo" }] },
                  serviceEndpoint: { feedbackEndpoint: { feedbackToken: "FIXTURE_UNDO" } },
                },
              },
            ],
          },
        },
      },
    },
  ],
};

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
  await page.route(HOME_URL, async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html", body: html });
  });
});

test.afterEach(async () => {
  await page.close();
});

/** Captures every feedback POST body and answers with `body`. */
async function captureFeedback(body: unknown): Promise<string[]> {
  const posted: string[] = [];
  await page.route(FEEDBACK_URL, async (route, request) => {
    posted.push(request.postData() ?? "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  return posted;
}

test("video card gets Not interested and Don't recommend channel buttons on its thumbnail", async () => {
  await page.goto(HOME_URL);
  const box = page.locator("#card-1 yt-thumbnail-view-model .ythc-fb-box");
  await expect(box).toHaveCount(1, { timeout: 5000 });
  const buttons = box.locator(".ythc-fb-btn");
  await expect(buttons).toHaveCount(2);
  await expect(buttons.nth(0)).toHaveAttribute("aria-label", "Not interested");
  await expect(buttons.nth(1)).toHaveAttribute("aria-label", "Don't recommend channel");
});

test("short gets only Not interested; mix gets no buttons", async () => {
  await page.goto(HOME_URL);
  await expect(page.locator("#card-1 .ythc-fb-btn")).toHaveCount(2, { timeout: 5000 });
  const shortButtons = page.locator("#card-short .ythc-fb-btn");
  await expect(shortButtons).toHaveCount(1);
  await expect(shortButtons).toHaveAttribute("aria-label", "Not interested");
  await expect(page.locator("#card-mix .ythc-fb-btn")).toHaveCount(0);
});

test("Not interested posts the card's token and swaps in a Video removed placeholder", async () => {
  const posted = await captureFeedback(undoResponse);
  await page.goto(HOME_URL);

  const responsePromise = page.waitForResponse((r) => r.url().includes("/youtubei/v1/feedback"));
  await page.locator('#card-1 .ythc-fb-btn[data-action="notInterested"]').click();
  await responsePromise;

  expect(posted[0]).toContain("FIXTURE_HOME_NI");
  const placeholder = page.locator("#card-1 .ythc-removed");
  await expect(placeholder).toBeVisible();
  await expect(placeholder.locator(".ythc-removed-msg")).toHaveText("Video removed");
  await expect(page.locator("#card-1 yt-lockup-view-model")).toBeHidden();
  await expect(page).toHaveURL(HOME_URL);
});

test("Don't recommend channel shows the channel wording", async () => {
  await captureFeedback(undoResponse);
  await page.goto(HOME_URL);
  await page.locator('#card-1 .ythc-fb-btn[data-action="dontRecommendChannel"]').click();
  await expect(page.locator("#card-1 .ythc-removed-msg")).toHaveText(
    "We won't recommend videos from this channel",
  );
});

test("Undo restores the card and posts the undo token, not the survey token", async () => {
  const posted = await captureFeedback(undoResponse);
  await page.goto(HOME_URL);

  await page.locator('#card-1 .ythc-fb-btn[data-action="notInterested"]').click();
  await expect(page.locator("#card-1 .ythc-removed")).toBeVisible();

  const undoResponsePromise = page.waitForResponse(
    (r) => r.url().includes("/youtubei/v1/feedback") && posted.length >= 2,
  );
  await page.locator("#card-1 .ythc-removed-undo").click();
  await undoResponsePromise;

  expect(posted).toHaveLength(2);
  expect(posted[1]).toContain("FIXTURE_UNDO");
  expect(posted[1]).not.toContain("FIXTURE_SURVEY");
  await expect(page.locator("#card-1 .ythc-removed")).toHaveCount(0);
  await expect(page.locator("#card-1 yt-lockup-view-model")).toBeVisible();
  await expect(page.locator("#card-1 .ythc-fb-btn")).toHaveCount(2);
  // The undo request must have succeeded silently.
  await expect(page.locator(".ythc-toast")).toHaveCount(0);
});

test("Undo is removed when the response carries no undo token", async () => {
  await captureFeedback({ feedbackResponses: [{ isProcessed: true }], actions: [] });
  await page.goto(HOME_URL);
  await page.locator('#card-1 .ythc-fb-btn[data-action="notInterested"]').click();
  await expect(page.locator("#card-1 .ythc-removed")).toBeVisible();
  await expect(page.locator("#card-1 .ythc-removed-undo")).toHaveCount(0);
});

test("a card rendered after load is decorated by the observer without any fetch", async () => {
  await page.goto(HOME_URL);
  await expect(page.locator("#card-1 .ythc-fb-btn")).toHaveCount(2, { timeout: 5000 });

  // Same video as card-1, so its tokens are already known from ytInitialData.
  await page.evaluate(() => {
    const card = document.createElement("ytd-rich-item-renderer");
    card.id = "card-observed";
    const content = document.createElement("div");
    content.id = "content";
    const lockup = document.createElement("yt-lockup-view-model");
    const link = document.createElement("a");
    link.href = "https://www.youtube.com/watch?v=fixtureHom1";
    lockup.append(link, document.createElement("yt-thumbnail-view-model"));
    content.appendChild(lockup);
    card.appendChild(content);
    document.querySelector("#contents")!.appendChild(card);
  });

  await expect(page.locator("#card-observed .ythc-fb-btn")).toHaveCount(2, { timeout: 5000 });
});

test("history decorations do not bleed onto home cards after History → Home SPA navigation", async () => {
  const historyHtml = await readFile(resolve(here, "fixtures", "history.html"), "utf8");
  await page.route("https://www.youtube.com/feed/history*", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: historyHtml }),
  );
  await page.goto("https://www.youtube.com/feed/history");
  await expect(page.locator("#row-1 .ythc-delete-btn")).toHaveCount(1, { timeout: 5000 });

  // Client-side route change to Home, then a home card renders.
  await page.evaluate(() => {
    history.pushState({}, "", "/");
    window.dispatchEvent(new Event("yt-navigate-finish"));
    const card = document.createElement("ytd-rich-item-renderer");
    card.id = "card-after-nav";
    const content = document.createElement("div");
    content.id = "content";
    const lockup = document.createElement("yt-lockup-view-model");
    const link = document.createElement("a");
    link.href = "https://www.youtube.com/watch?v=fixtureVid1";
    lockup.append(link, document.createElement("yt-thumbnail-view-model"));
    content.appendChild(lockup);
    card.appendChild(content);
    document.body.appendChild(card);
  });

  // Give the observers a tick, then assert nothing history-shaped landed.
  await page.waitForTimeout(200);
  await expect(page.locator("#card-after-nav .ythc-delete-btn")).toHaveCount(0);
  await expect(page.locator("#card-after-nav .ythc-channel-delete-btn")).toHaveCount(0);
});

test("a failed request restores the card and shows a toast", async () => {
  await page.route(FEEDBACK_URL, (route) => route.fulfill({ status: 403, body: "{}" }));
  await page.goto(HOME_URL);

  await page.locator('#card-1 .ythc-fb-btn[data-action="notInterested"]').click();

  await expect(page.locator(".ythc-toast")).toContainText("Failed to send feedback");
  await expect(page.locator("#card-1 .ythc-removed")).toHaveCount(0);
  await expect(page.locator("#card-1 yt-lockup-view-model")).toBeVisible();
});

test("SPA navigation clears placeholders", async () => {
  await captureFeedback(undoResponse);
  await page.goto(HOME_URL);
  await page.locator('#card-1 .ythc-fb-btn[data-action="notInterested"]').click();
  await expect(page.locator("#card-1 .ythc-removed")).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event("yt-navigate-finish")));

  await expect(page.locator("#card-1 .ythc-removed")).toHaveCount(0);
  await expect(page.locator("#card-1 yt-lockup-view-model")).toBeVisible();
});

test("cards that arrive with a browse continuation get their buttons", async () => {
  await page.route("https://www.youtube.com/youtubei/v1/browse*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        onResponseReceivedActions: [
          {
            richItemRenderer: {
              content: {
                lockupViewModel: {
                  contentId: "fixtureLat1",
                  metadata: {
                    lockupMetadataViewModel: {
                      menuButton: {
                        buttonViewModel: {
                          onTap: {
                            innertubeCommand: {
                              showSheetCommand: {
                                panelLoadingStrategy: {
                                  inlineContent: {
                                    sheetViewModel: {
                                      content: {
                                        listViewModel: {
                                          listItems: [
                                            {
                                              listItemViewModel: {
                                                title: { content: "Not interested" },
                                                rendererContext: {
                                                  commandContext: {
                                                    onTap: {
                                                      innertubeCommand: {
                                                        feedbackEndpoint: {
                                                          feedbackToken: "FIXTURE_LATE_NI",
                                                        },
                                                      },
                                                    },
                                                  },
                                                },
                                              },
                                            },
                                          ],
                                        },
                                      },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      }),
    }),
  );
  await page.goto(HOME_URL);
  await expect(page.locator("#card-1 .ythc-fb-btn")).toHaveCount(2, { timeout: 5000 });

  // Append a card the initial payload knew nothing about, then let the page
  // fetch a continuation the way YouTube does on scroll.
  await page.evaluate(async () => {
    const card = document.createElement("ytd-rich-item-renderer");
    card.id = "card-late";
    const content = document.createElement("div");
    content.id = "content";
    const lockup = document.createElement("yt-lockup-view-model");
    const link = document.createElement("a");
    link.href = "https://www.youtube.com/watch?v=fixtureLat1";
    const thumb = document.createElement("yt-thumbnail-view-model");
    lockup.append(link, thumb);
    content.appendChild(lockup);
    card.appendChild(content);
    document.querySelector("#contents")!.appendChild(card);
    await fetch("https://www.youtube.com/youtubei/v1/browse?key=FIXTURE_KEY", {
      method: "POST",
      body: "{}",
    });
  });

  const lateButtons = page.locator("#card-late .ythc-fb-btn");
  await expect(lateButtons).toHaveCount(1, { timeout: 5000 });
  await expect(lateButtons).toHaveAttribute("aria-label", "Not interested");
});
