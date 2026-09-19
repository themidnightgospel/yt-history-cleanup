import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  readStoredGrayscale,
  isGrayscaleApplied,
  setGrayscaleEnabled,
  applyGrayscale,
  ensureGrayscaleToggle,
  initGrayscale,
  pageKind,
  GRAYSCALE_STORAGE_KEY,
  GRAYSCALE_ATTR,
  PAGE_ATTR,
  TOGGLE_CLASS,
} from "./grayscale.js";

function makeMasthead(): HTMLElement {
  const masthead = document.createElement("ytd-masthead");
  const end = document.createElement("div");
  end.id = "end";
  const buttons = document.createElement("div");
  buttons.id = "buttons";
  end.appendChild(buttons);
  masthead.appendChild(end);
  document.body.appendChild(masthead);
  return end;
}

function toggle(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`);
}

function blockStorage(): void {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute(GRAYSCALE_ATTR);
  document.documentElement.removeAttribute(PAGE_ATTR);
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("readStoredGrayscale", () => {
  it("defaults to on when nothing was ever stored", () => {
    expect(readStoredGrayscale()).toBe(true);
  });

  it("reads a stored off", () => {
    localStorage.setItem(GRAYSCALE_STORAGE_KEY, "0");
    expect(readStoredGrayscale()).toBe(false);
  });

  it("defaults to on when localStorage throws", () => {
    blockStorage();
    expect(readStoredGrayscale()).toBe(true);
  });
});

describe("applyGrayscale / setGrayscaleEnabled", () => {
  it("stamps and removes the html attribute", () => {
    applyGrayscale(true);
    expect(isGrayscaleApplied()).toBe(true);
    expect(document.documentElement.getAttribute(GRAYSCALE_ATTR)).toBe("1");
    applyGrayscale(false);
    expect(isGrayscaleApplied()).toBe(false);
  });

  it("persists the choice and applies it", () => {
    setGrayscaleEnabled(false);
    expect(localStorage.getItem(GRAYSCALE_STORAGE_KEY)).toBe("0");
    expect(isGrayscaleApplied()).toBe(false);
    setGrayscaleEnabled(true);
    expect(localStorage.getItem(GRAYSCALE_STORAGE_KEY)).toBe("1");
    expect(isGrayscaleApplied()).toBe(true);
  });

  it("still applies when persistence fails", () => {
    blockStorage();
    setGrayscaleEnabled(true);
    expect(isGrayscaleApplied()).toBe(true);
    setGrayscaleEnabled(false);
    expect(isGrayscaleApplied()).toBe(false);
  });
});

describe("ensureGrayscaleToggle", () => {
  it("inserts one button in front of the masthead's right-hand buttons", () => {
    const end = makeMasthead();
    ensureGrayscaleToggle();
    ensureGrayscaleToggle();
    expect(document.querySelectorAll(`.${TOGGLE_CLASS}`)).toHaveLength(1);
    expect(end.firstElementChild).toBe(toggle());
    expect(toggle()!.querySelector("svg")).not.toBeNull();
  });

  it("waits for a late masthead and inserts once it appears", async () => {
    ensureGrayscaleToggle();
    expect(toggle()).toBeNull();
    makeMasthead();
    await vi.waitFor(() => expect(toggle()).not.toBeNull());
  });

  it("keeps a constant accessible name and conveys state via aria-pressed", () => {
    makeMasthead();
    initGrayscale();
    expect(toggle()!.getAttribute("aria-label")).toBe("Grayscale thumbnails");
    expect(toggle()!.getAttribute("aria-pressed")).toBe("true");
    expect(toggle()!.title).toBe("Grayscale thumbnails: on");
    setGrayscaleEnabled(false);
    expect(toggle()!.getAttribute("aria-label")).toBe("Grayscale thumbnails");
    expect(toggle()!.getAttribute("aria-pressed")).toBe("false");
    expect(toggle()!.title).toBe("Grayscale thumbnails: off");
  });

  it("clicking flips the setting, persists it, and updates the html attribute", () => {
    makeMasthead();
    initGrayscale();
    expect(isGrayscaleApplied()).toBe(true);

    toggle()!.click();
    expect(isGrayscaleApplied()).toBe(false);
    expect(localStorage.getItem(GRAYSCALE_STORAGE_KEY)).toBe("0");

    toggle()!.click();
    expect(isGrayscaleApplied()).toBe(true);
    expect(localStorage.getItem(GRAYSCALE_STORAGE_KEY)).toBe("1");
  });

  it("stays in sync with the applied state when storage is blocked", () => {
    makeMasthead();
    initGrayscale();
    blockStorage();

    toggle()!.click();
    expect(isGrayscaleApplied()).toBe(false);
    expect(toggle()!.getAttribute("aria-pressed")).toBe("false");

    toggle()!.click();
    expect(isGrayscaleApplied()).toBe(true);
    expect(toggle()!.getAttribute("aria-pressed")).toBe("true");
  });

  it("initGrayscale applies a previously stored off without a toggle present", () => {
    localStorage.setItem(GRAYSCALE_STORAGE_KEY, "0");
    initGrayscale();
    expect(isGrayscaleApplied()).toBe(false);
  });

  it("follows a change made in another tab", () => {
    makeMasthead();
    initGrayscale();
    expect(isGrayscaleApplied()).toBe(true);

    localStorage.setItem(GRAYSCALE_STORAGE_KEY, "0");
    window.dispatchEvent(
      new StorageEvent("storage", { key: GRAYSCALE_STORAGE_KEY, newValue: "0" }),
    );
    expect(isGrayscaleApplied()).toBe(false);
    expect(toggle()!.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("page scoping", () => {
  it("classifies only the home and watch paths", () => {
    expect(pageKind("/")).toBe("home");
    expect(pageKind("/watch")).toBe("watch");
    expect(pageKind("/feed/subscriptions")).toBeNull();
    expect(pageKind("/@somechannel/videos")).toBeNull();
    expect(pageKind("/results")).toBeNull();
    expect(pageKind("/feed/history")).toBeNull();
  });

  it("initGrayscale stamps the page kind for the current location", () => {
    // jsdom runs at /feed/history, which is neither home nor watch.
    initGrayscale();
    expect(document.documentElement.hasAttribute(PAGE_ATTR)).toBe(false);

    history.pushState({}, "", "/watch?v=abc");
    initGrayscale();
    expect(document.documentElement.getAttribute(PAGE_ATTR)).toBe("watch");

    history.pushState({}, "", "/");
    initGrayscale();
    expect(document.documentElement.getAttribute(PAGE_ATTR)).toBe("home");
  });
});
