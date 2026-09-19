import { LOG_PREFIX } from "./log.js";
import { makeSvgIcon } from "./dom-shared.js";

// Grayscale thumbnails: a `grayscale mode` flag on <html> that content.css
// turns into a CSS filter on home-feed and watch-sidebar thumbnails. The
// flag persists in youtube.com localStorage (see docs/adr/0006) and is
// flipped by a toggle button injected into YouTube's masthead.

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

export function isGrayscaleEnabled(): boolean {
  try {
    // Absent key means never toggled: default on.
    return localStorage.getItem(GRAYSCALE_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setGrayscaleEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(GRAYSCALE_STORAGE_KEY, enabled ? "1" : "0");
  } catch (err) {
    console.warn(`${LOG_PREFIX} could not persist grayscale setting`, err);
  }
  applyGrayscale(enabled);
  syncToggleButton();
}

export function applyGrayscale(enabled: boolean): void {
  const html = document.documentElement;
  if (enabled) html.setAttribute(GRAYSCALE_ATTR, "1");
  else html.removeAttribute(GRAYSCALE_ATTR);
}

/** Idempotent: creates the masthead toggle once, then keeps its state fresh. */
export function ensureGrayscaleToggle(): void {
  if (document.querySelector(`.${TOGGLE_CLASS}`)) {
    syncToggleButton();
    return;
  }
  const end = document.querySelector<HTMLElement>(MASTHEAD_END_SELECTOR);
  if (!end) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = TOGGLE_CLASS;
  btn.appendChild(makeSvgIcon(CONTRAST_PATH_D, ICON_SIZE));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    setGrayscaleEnabled(!isGrayscaleEnabled());
  });
  end.insertBefore(btn, end.firstChild);
  syncToggleButton();
}

function syncToggleButton(): void {
  const btn = document.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`);
  if (!btn) return;
  const on = isGrayscaleEnabled();
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  const label = `Grayscale thumbnails: ${on ? "on" : "off"}`;
  btn.title = label;
  btn.setAttribute("aria-label", label);
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

/** Applies the persisted state; safe to call on every navigation. */
export function initGrayscale(): void {
  applyPageKind();
  applyGrayscale(isGrayscaleEnabled());
  ensureGrayscaleToggle();
}
