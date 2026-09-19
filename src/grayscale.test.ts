import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isGrayscaleEnabled,
  setGrayscaleEnabled,
  applyGrayscale,
  ensureGrayscaleToggle,
  initGrayscale,
  GRAYSCALE_STORAGE_KEY,
  GRAYSCALE_ATTR,
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

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute(GRAYSCALE_ATTR);
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("isGrayscaleEnabled", () => {
  it("defaults to on when nothing was ever stored", () => {
    expect(isGrayscaleEnabled()).toBe(true);
  });

  it("reads a stored off", () => {
    localStorage.setItem(GRAYSCALE_STORAGE_KEY, "0");
    expect(isGrayscaleEnabled()).toBe(false);
  });

  it("defaults to on when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(isGrayscaleEnabled()).toBe(true);
  });
});

describe("applyGrayscale / setGrayscaleEnabled", () => {
  it("stamps and removes the html attribute", () => {
    applyGrayscale(true);
    expect(document.documentElement.getAttribute(GRAYSCALE_ATTR)).toBe("1");
    applyGrayscale(false);
    expect(document.documentElement.hasAttribute(GRAYSCALE_ATTR)).toBe(false);
  });

  it("persists the choice and applies it", () => {
    setGrayscaleEnabled(false);
    expect(localStorage.getItem(GRAYSCALE_STORAGE_KEY)).toBe("0");
    expect(document.documentElement.hasAttribute(GRAYSCALE_ATTR)).toBe(false);
    setGrayscaleEnabled(true);
    expect(localStorage.getItem(GRAYSCALE_STORAGE_KEY)).toBe("1");
    expect(document.documentElement.getAttribute(GRAYSCALE_ATTR)).toBe("1");
  });

  it("still applies when persistence fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setGrayscaleEnabled(true);
    expect(document.documentElement.getAttribute(GRAYSCALE_ATTR)).toBe("1");
  });
});

describe("ensureGrayscaleToggle", () => {
  it("does nothing when the masthead is not rendered yet", () => {
    ensureGrayscaleToggle();
    expect(toggle()).toBeNull();
  });

  it("inserts one button in front of the masthead's right-hand buttons", () => {
    const end = makeMasthead();
    ensureGrayscaleToggle();
    ensureGrayscaleToggle();
    expect(document.querySelectorAll(`.${TOGGLE_CLASS}`)).toHaveLength(1);
    expect(end.firstElementChild).toBe(toggle());
    expect(toggle()!.querySelector("svg")).not.toBeNull();
  });

  it("reflects the current state in aria-pressed and label", () => {
    makeMasthead();
    ensureGrayscaleToggle();
    expect(toggle()!.getAttribute("aria-pressed")).toBe("true");
    expect(toggle()!.title).toBe("Grayscale thumbnails: on");
    setGrayscaleEnabled(false);
    expect(toggle()!.getAttribute("aria-pressed")).toBe("false");
    expect(toggle()!.title).toBe("Grayscale thumbnails: off");
  });

  it("clicking flips the setting, persists it, and updates the html attribute", () => {
    makeMasthead();
    initGrayscale();
    expect(document.documentElement.hasAttribute(GRAYSCALE_ATTR)).toBe(true);

    toggle()!.click();
    expect(isGrayscaleEnabled()).toBe(false);
    expect(localStorage.getItem(GRAYSCALE_STORAGE_KEY)).toBe("0");
    expect(document.documentElement.hasAttribute(GRAYSCALE_ATTR)).toBe(false);

    toggle()!.click();
    expect(isGrayscaleEnabled()).toBe(true);
    expect(document.documentElement.hasAttribute(GRAYSCALE_ATTR)).toBe(true);
  });

  it("initGrayscale applies a previously stored off without a toggle present", () => {
    localStorage.setItem(GRAYSCALE_STORAGE_KEY, "0");
    initGrayscale();
    expect(document.documentElement.hasAttribute(GRAYSCALE_ATTR)).toBe(false);
  });
});
