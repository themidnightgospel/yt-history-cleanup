import { LOG_PREFIX } from "./log.js";
import { makeSvgIcon } from "./dom-shared.js";

// Grayscale thumbnails: a `grayscale mode` flag on <html> that content.css
// turns into a CSS filter on home-feed and watch-sidebar thumbnails. The
// flag persists in youtube.com localStorage (see docs/adr/0006) and is
// flipped by a toggle button injected into YouTube's masthead.
//
// The applied state (the <html> attribute) is the source of truth for the
// UI; storage is only how it survives reloads. If storage is blocked the
// toggle still works for the life of the page.

export const GRAYSCALE_STORAGE_KEY = "ythc-grayscale";
export const GRAYSCALE_ATTR = "data-ythc-grayscale";
/**
 * Which page we are on ("home" | "watch"), so content.css can limit the
 * filter to those two: `ytd-rich-item-renderer` also renders channel
 * pages, the Subscriptions feed, and search shelves.
 */
export const PAGE_ATTR = "data-ythc-page";
export const TOGGLE_CLASS = "ythc-grayscale-toggle";

// YouTube's masthead: `#end` holds the right-hand icon buttons (create,
// notifications, avatar). We insert in front of them.
const MASTHEAD_END_SELECTOR = "ytd-masthead #end";
const ICON_SIZE = 24;
// Material "contrast": a circle with its right half filled.
const CONTRAST_PATH_D =
  "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18V4c4.41 0 8 3.59 8 8s-3.59 8-8 8z";

export function readStoredGrayscale(): boolean {
  try {
    // Absent key means never toggled: default on.
    return localStorage.getItem(GRAYSCALE_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

/** The state currently applied to the page. */
export function isGrayscaleApplied(): boolean {
  return document.documentElement.hasAttribute(GRAYSCALE_ATTR);
}

export function setGrayscaleEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(GRAYSCALE_STORAGE_KEY, enabled ? "1" : "0");
  } catch (err) {
    console.warn(`${LOG_PREFIX} could not persist grayscale setting`, err);
  }
  applyGrayscale(enabled);
}

export function applyGrayscale(enabled: boolean): void {
  const html = document.documentElement;
  if (enabled) html.setAttribute(GRAYSCALE_ATTR, "1");
  else html.removeAttribute(GRAYSCALE_ATTR);
  syncToggleButton();
}

export function pageKind(pathname: string): "home" | "watch" | null {
  if (pathname === "/") return "home";
  if (pathname === "/watch") return "watch";
  return null;
}

export function applyPageKind(): void {
  const kind = pageKind(location.pathname);
  const html = document.documentElement;
  if (kind) html.setAttribute(PAGE_ATTR, kind);
  else html.removeAttribute(PAGE_ATTR);
}

let mastheadObserver: MutationObserver | null = null;

/**
 * Idempotent: creates the masthead toggle once, then keeps its state fresh.
 * If the masthead has not been stamped yet, waits for it once.
 */
export function ensureGrayscaleToggle(): void {
  if (document.querySelector(`.${TOGGLE_CLASS}`)) {
    syncToggleButton();
    return;
  }
  const end = document.querySelector<HTMLElement>(MASTHEAD_END_SELECTOR);
  if (!end) {
    waitForMasthead();
    return;
  }
  mastheadObserver?.disconnect();
  mastheadObserver = null;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = TOGGLE_CLASS;
  // Constant accessible name; the state is conveyed by aria-pressed.
  btn.setAttribute("aria-label", "Grayscale thumbnails");
  btn.appendChild(makeSvgIcon(CONTRAST_PATH_D, ICON_SIZE));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    setGrayscaleEnabled(!isGrayscaleApplied());
  });
  end.insertBefore(btn, end.firstChild);
  syncToggleButton();
}

function waitForMasthead(): void {
  if (mastheadObserver || !document.body) return;
  mastheadObserver = new MutationObserver(() => {
    if (document.querySelector(MASTHEAD_END_SELECTOR)) ensureGrayscaleToggle();
  });
  mastheadObserver.observe(document.body, { childList: true, subtree: true });
}

function syncToggleButton(): void {
  const btn = document.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`);
  if (!btn) return;
  const on = isGrayscaleApplied();
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.title = `Grayscale thumbnails: ${on ? "on" : "off"}`;
}

let storageListenerInstalled = false;

/** Applies the persisted state; safe to call on every navigation. */
export function initGrayscale(): void {
  applyPageKind();
  applyGrayscale(readStoredGrayscale());
  ensureGrayscaleToggle();
  if (!storageListenerInstalled) {
    storageListenerInstalled = true;
    // Another youtube.com tab toggled it: follow without waiting for a
    // navigation.
    window.addEventListener("storage", (e) => {
      if (e.key === GRAYSCALE_STORAGE_KEY || e.key === null) {
        applyGrayscale(readStoredGrayscale());
      }
    });
  }
}
