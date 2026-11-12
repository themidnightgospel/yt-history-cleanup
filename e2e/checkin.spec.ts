import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, "..", "dist");

const WATCH_URL = "https://www.youtube.com/watch?v=fixtureMain";
const HOME_URL = "https://www.youtube.com/";
const OVERLAY = "#movie_player .ythc-checkin";
const KEEP = `${OVERLAY} .ythc-checkin-keep`;
const CLOSE = `${OVERLAY} .ythc-checkin-close`;
const TOGGLE = "ytd-masthead #end .ythc-checkin-toggle";
// youtube.com enforces Trusted Types; serve the watch fixture the same way.
const TRUSTED_TYPES_CSP = { "Content-Security-Policy": "require-trusted-types-for 'script'" };

let context: BrowserContext;
let page: Page;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
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
  // The profile is shared between tests: leave the preference at its default.
  await page.evaluate(() => localStorage.removeItem("ythc-checkin")).catch(() => {});
  await page.close();
});

/**
 * The fixture's <video> has no media, so fake its clock and play state on
 * the element itself. The content script listens to this same element.
 */
async function fakePlayback(): Promise<void> {
  await page.evaluate(() => {
    const v = document.querySelector("video")!;
    const s = { paused: true, time: 0 };
    Object.defineProperty(v, "paused", { configurable: true, get: () => s.paused });
    Object.defineProperty(v, "ended", { configurable: true, get: () => false });
    Object.defineProperty(v, "currentTime", {
      configurable: true,
      get: () => s.time,
      set: (t: number) => {
        s.time = t;
      },
    });
    v.play = () => {
      if (s.paused) {
        s.paused = false;
        v.dispatchEvent(new Event("play"));
      }
      return Promise.resolve();
    };
    v.pause = () => {
      if (!s.paused) {
        s.paused = true;
        v.dispatchEvent(new Event("pause"));
      }
    };
    (window as unknown as { __advance: (sec: number) => void }).__advance = (sec: number) => {
      for (let i = 0; i < sec * 4 && !s.paused; i++) {
        s.time += 0.25;
        v.dispatchEvent(new Event("timeupdate"));
      }
    };
  });
}

async function watchFor(seconds: number, url = WATCH_URL): Promise<void> {
  await page.goto(url);
  await expect(page.locator(TOGGLE)).toHaveCount(1, { timeout: 5000 });
  await fakePlayback();
  await page.evaluate((sec) => {
    document.querySelector("video")!.play();
    (window as unknown as { __advance: (s: number) => void }).__advance(sec);
  }, seconds);
}

function paused(): Promise<boolean> {
  return page.evaluate(() => document.querySelector("video")!.paused);
}

test("the masthead toggle sits right after the grayscale toggle, on by default", async () => {
  await page.goto(HOME_URL);
  await expect(page.locator(TOGGLE)).toHaveCount(1, { timeout: 5000 });
  const prev = await page.evaluate(
    () => document.querySelector(".ythc-checkin-toggle")!.previousElementSibling!.className,
  );
  expect(prev).toContain("ythc-grayscale-toggle");
  await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "true");
});

test("after a minute of playback the meme pauses the video; On purpose resumes it", async () => {
  await watchFor(61);
  await expect(page.locator(OVERLAY)).toBeVisible();
  await expect(page.locator(`${OVERLAY} .ythc-checkin-text`)).toHaveCount(2);
  expect(await paused()).toBe(true);
  await page.locator(KEEP).click();
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  expect(await paused()).toBe(false);
});

test("no answer within five seconds resumes the video", async () => {
  await watchFor(61);
  await expect(page.locator(OVERLAY)).toBeVisible();
  await expect(page.locator(OVERLAY)).toHaveCount(0, { timeout: 7000 });
  expect(await paused()).toBe(false);
});

test("Zombie. Close it. goes home with an Undo that returns to the same second, paused", async () => {
  await watchFor(61);
  await page.locator(CLOSE).click();
  await page.waitForURL(HOME_URL);
  const toast = page.locator(".ythc-toast");
  await expect(toast).toContainText("Closed:");
  await toast.locator(".ythc-toast-action").click();
  await page.waitForURL(/\/watch\?v=fixtureMain&t=60s$/);
  await expect(page.locator(TOGGLE)).toHaveCount(1, { timeout: 5000 });
  // The resume request was picked up by the watch page.
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("ythc-checkin-resume")))
    .toBeNull();
});

test("the Undo toast goes away after five seconds", async () => {
  await watchFor(61);
  await page.locator(CLOSE).click();
  await page.waitForURL(HOME_URL);
  await expect(page.locator(".ythc-toast")).toBeVisible();
  await expect(page.locator(".ythc-toast")).toHaveCount(0, { timeout: 7000 });
});

test("no check-in in a playlist the user started", async () => {
  await watchFor(120, `${WATCH_URL}&list=PLfixture`);
  await expect(page.locator(OVERLAY)).toHaveCount(0);
});

test("turned off in the masthead, no check-in, and the choice survives a reload", async () => {
  await page.goto(WATCH_URL);
  await page.locator(TOGGLE).click();
  await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "false", { timeout: 5000 });
  await fakePlayback();
  await page.evaluate(() => {
    document.querySelector("video")!.play();
    (window as unknown as { __advance: (s: number) => void }).__advance(120);
  });
  await expect(page.locator(OVERLAY)).toHaveCount(0);
});

function play(): Promise<void> {
  return page.evaluate(() => {
    void document.querySelector("video")!.play();
  });
}

function advance(seconds: number): Promise<void> {
  return page.evaluate((sec) => {
    (window as unknown as { __advance: (s: number) => void }).__advance(sec);
  }, seconds);
}

test("pressing play instead of answering counts as keep watching", async () => {
  await watchFor(61);
  await expect(page.locator(OVERLAY)).toBeVisible();
  await play();
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  expect(await paused()).toBe(false);
  // The next check-in is a full ten minutes away.
  await advance(590);
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  await advance(15);
  await expect(page.locator(OVERLAY)).toBeVisible();
});

test("coming back from a pause of 30 seconds or more shows a check-in; a short one does not", async () => {
  await page.clock.install();
  await watchFor(10);
  await page.evaluate(() => document.querySelector("video")!.pause());
  await page.clock.fastForward(20_000);
  await play();
  await expect(page.locator(OVERLAY)).toHaveCount(0);

  await page.evaluate(() => document.querySelector("video")!.pause());
  await page.clock.fastForward(31_000);
  await play();
  await expect(page.locator(OVERLAY)).toBeVisible();
  expect(await paused()).toBe(true);
});

test("a check-in due in a hidden tab waits until the tab is visible", async () => {
  await page.goto(WATCH_URL);
  await expect(page.locator(TOGGLE)).toHaveCount(1, { timeout: 5000 });
  await fakePlayback();
  await page.evaluate(() => {
    const w = window as unknown as { __hidden: boolean };
    w.__hidden = true;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => w.__hidden });
  });
  await play();
  await advance(61);
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  expect(await paused()).toBe(false);
  await page.evaluate(() => {
    (window as unknown as { __hidden: boolean }).__hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator(OVERLAY)).toBeVisible();
});

test("music videos get no check-ins", async () => {
  await page.goto(WATCH_URL);
  await expect(page.locator(TOGGLE)).toHaveCount(1, { timeout: 5000 });
  await fakePlayback();
  await page.evaluate(() => {
    (document.getElementById("movie_player") as unknown as { getPlayerResponse: () => unknown }).getPlayerResponse =
      () => ({ microformat: { playerMicroformatRenderer: { category: "Music" } } });
  });
  await play();
  await advance(120);
  await expect(page.locator(OVERLAY)).toHaveCount(0);
});

test("moving to another video in the app starts a fresh one-minute clock", async () => {
  await watchFor(50);
  await page.evaluate(() => {
    history.pushState(null, "", "/watch?v=fixtureOther");
    document.querySelector("video")!.dispatchEvent(new Event("loadstart"));
    window.dispatchEvent(new Event("yt-navigate-finish"));
  });
  await advance(50);
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  await advance(11);
  await expect(page.locator(OVERLAY)).toBeVisible();
});

test("clicks on the meme stay on the meme", async () => {
  await watchFor(61);
  await page.evaluate(() => {
    const w = window as unknown as { __playerClicks: number };
    w.__playerClicks = 0;
    document.getElementById("movie_player")!.addEventListener("click", () => w.__playerClicks++);
  });
  // The dimmed background, top-left corner (the swaying emoji never holds
  // still long enough for a click).
  await page.locator(OVERLAY).click({ position: { x: 8, y: 8 } });
  await expect(page.locator(OVERLAY)).toBeVisible();
  expect(await paused()).toBe(true);
  await page.locator(KEEP).click();
  expect(await page.evaluate(() => (window as unknown as { __playerClicks: number }).__playerClicks)).toBe(0);
});

test("the buttons are reachable from the keyboard", async () => {
  await watchFor(61);
  await page.locator(KEEP).focus();
  await page.keyboard.press("Tab");
  await expect(page.locator(CLOSE)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  expect(await paused()).toBe(false);
});

test("after Undo, YouTube's autoplay is paused so playing on is your choice", async () => {
  await watchFor(61);
  await page.locator(CLOSE).click();
  await page.waitForURL(HOME_URL);
  await page.locator(".ythc-toast .ythc-toast-action").click();
  await page.waitForURL(/t=60s$/);
  await expect(page.locator(TOGGLE)).toHaveCount(1, { timeout: 5000 });
  await fakePlayback();
  await play(); // YouTube's autoplay
  expect(await paused()).toBe(true);
  await play(); // the user's own choice
  expect(await paused()).toBe(false);
  await expect(page.locator(OVERLAY)).toHaveCount(0);
});

test("Don't ask for this one resumes and silences check-ins for this video only", async () => {
  await watchFor(61);
  const mute = page.locator(`${OVERLAY} .ythc-checkin-mute`);
  await expect(mute).toHaveText("Don't ask for this one");
  await mute.click();
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  expect(await paused()).toBe(false);
  await advance(1200);
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  // The next video asks again.
  await page.evaluate(() => {
    history.pushState(null, "", "/watch?v=fixtureOther");
    document.querySelector("video")!.dispatchEvent(new Event("loadstart"));
    window.dispatchEvent(new Event("yt-navigate-finish"));
  });
  await advance(61);
  await expect(page.locator(OVERLAY)).toBeVisible();
});
