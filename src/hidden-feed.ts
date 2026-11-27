import { LOG_PREFIX } from "./log.js";
import { makeSvgIcon, showToast } from "./dom-shared.js";

// Hidden recommendations: the home page's grid is hidden and a "What did
// you come here for?" search box takes its place; on a watch page the
// "Up next" sidebar and the end-of-video wall of suggestions are hidden,
// with a one-line note in the sidebar. A masthead button shows both, but
// only for one minute; then they hide themselves again. See docs/adr/0010.
//
// Hidden is the resting state and cannot be switched off for good. The
// only thing stored is when the current peek ends, as epoch milliseconds
// in youtube.com localStorage, so a reload does not grant a fresh minute
// and other youtube.com tabs follow the same timer. As with grayscale, the
// <html> attribute is what the CSS reads; storage only carries it across
// reloads and tabs.

export const SHOWN_UNTIL_KEY = "ythc-feed-shown-until";
export const HIDDEN_ATTR = "data-ythc-feed-hidden";
export const TOGGLE_CLASS = "ythc-feed-toggle";
export const PILL_CLASS = "ythc-feed-pill";
export const PROMPT_CLASS = "ythc-feed-prompt";
export const UPNEXT_NOTE_CLASS = "ythc-upnext-note";
export const PEEK_MS = 60_000;
const TICK_MS = 250;

const MASTHEAD_END_SELECTOR = "ytd-masthead #end";
// Our other masthead controls; the feed toggle goes after whichever exists.
const NEIGHBOUR_SELECTORS = [".ythc-checkin-control", ".ythc-grayscale-toggle"];
// The home page's grid, chips bar included. Other feeds (Subscriptions,
// channel pages) reuse the element, so content.css also keys on the page.
const GRID_SELECTOR = "ytd-rich-grid-renderer";
const HOME_BROWSE_SELECTOR = 'ytd-browse[page-subtype="home"]';
// The watch page's "Up next" list, in the sidebar or, in a narrow window,
// under the video. A playlist panel is a separate element and stays.
const UPNEXT_SELECTOR = "ytd-watch-next-secondary-results-renderer";
const ICON_SIZE = 24;
// Material "visibility" and "visibility_off".
const EYE_PATH_D =
  "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z";
const EYE_OFF_PATH_D =
  "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z";

// Material "search", the magnifier YouTube's own search button shows.
const SEARCH_PATH_D =
  "M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z";

/**
 * Milliseconds of the current peek left at `now`, from the stored end
 * time. 0 means hidden. An end time more than one peek away cannot have
 * come from the button (the clock moved, or the value was edited), so it
 * counts as hidden rather than as a long reveal.
 */
export function peekRemaining(stored: string | null, now: number): number {
  if (stored === null) return 0;
  const until = Number(stored);
  if (!Number.isFinite(until)) return 0;
  const left = until - now;
  return left > 0 && left <= PEEK_MS ? left : 0;
}

/** "0:42" for the button; rounds up so the last second reads 0:01. */
export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function readStored(): string | null {
  try {
    return localStorage.getItem(SHOWN_UNTIL_KEY);
  } catch {
    return null;
  }
}

// The peek end in force for this page. Kept in memory too, so the button
// works for the life of the page when storage is blocked.
let shownUntil = 0;
let ticker: ReturnType<typeof setInterval> | null = null;
let mastheadObserver: MutationObserver | null = null;
let gridObserver: MutationObserver | null = null;
let upNextObserver: MutationObserver | null = null;
let storageListenerInstalled = false;

export function remainingMs(now: number = Date.now()): number {
  return peekRemaining(String(shownUntil), now);
}

export function isFeedHidden(): boolean {
  return document.documentElement.hasAttribute(HIDDEN_ATTR);
}

/** Shows the feed for one minute from now. */
export function showFeedForAMinute(): void {
  shownUntil = Date.now() + PEEK_MS;
  try {
    localStorage.setItem(SHOWN_UNTIL_KEY, String(shownUntil));
  } catch (err) {
    console.warn(`${LOG_PREFIX} could not persist the feed peek`, err);
  }
  apply();
}

/** Ends the peek now. */
export function hideFeedNow(): void {
  shownUntil = 0;
  try {
    localStorage.removeItem(SHOWN_UNTIL_KEY);
  } catch {
    // Nothing stored, or storage blocked: either way hidden is the default.
  }
  apply();
}

/** Applies the state for this moment: attribute, button, and the ticker. */
function apply(): void {
  const left = remainingMs();
  if (left === 0) shownUntil = 0;
  const html = document.documentElement;
  if (left > 0) html.removeAttribute(HIDDEN_ATTR);
  else html.setAttribute(HIDDEN_ATTR, "1");
  syncButton(left);
  if (left > 0 && !ticker) ticker = setInterval(tick, TICK_MS);
  if (left === 0 && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

function tick(): void {
  const wasShowing = !isFeedHidden();
  apply();
  // Only where something visibly disappears.
  const path = location.pathname;
  if (wasShowing && isFeedHidden() && (path === "/" || path === "/watch")) {
    showToast("Time's up. Recommendations hidden again.");
  }
}

function syncButton(left: number): void {
  const btn = document.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`);
  if (!btn) return;
  const hidden = left === 0;
  btn.setAttribute("aria-pressed", hidden ? "true" : "false");
  btn.classList.toggle(PILL_CLASS, !hidden);
  const time = formatRemaining(left);
  btn.title = hidden
    ? "Recommendations hidden. Click to show them for 1 minute"
    : `Recommendations showing for ${time} more. Click to hide them now`;
  const want = hidden ? "off" : "on";
  if (btn.dataset.icon !== want) {
    btn.dataset.icon = want;
    btn.replaceChildren(makeSvgIcon(hidden ? EYE_OFF_PATH_D : EYE_PATH_D, ICON_SIZE));
    if (!hidden) {
      const label = document.createElement("span");
      label.className = `${PILL_CLASS}-time`;
      btn.appendChild(label);
    }
  }
  const label = btn.querySelector(`.${PILL_CLASS}-time`);
  if (label) label.textContent = time;
}

/**
 * Idempotent: creates the masthead button once, after our other masthead
 * controls. Waits for the masthead if it has not been stamped yet.
 */
export function ensureFeedToggle(): void {
  if (document.querySelector(`.${TOGGLE_CLASS}`)) {
    syncButton(remainingMs());
    return;
  }
  const end = document.querySelector<HTMLElement>(MASTHEAD_END_SELECTOR);
  if (!end) {
    if (mastheadObserver || !document.body) return;
    mastheadObserver = new MutationObserver(() => {
      if (document.querySelector(MASTHEAD_END_SELECTOR)) ensureFeedToggle();
    });
    mastheadObserver.observe(document.body, { childList: true, subtree: true });
    return;
  }
  mastheadObserver?.disconnect();
  mastheadObserver = null;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = TOGGLE_CLASS;
  // Constant name; aria-pressed says whether recommendations are hidden.
  btn.setAttribute("aria-label", "Hide recommendations");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (isFeedHidden()) showFeedForAMinute();
    else hideFeedNow();
  });
  const neighbour = NEIGHBOUR_SELECTORS.map((s) => end.querySelector<HTMLElement>(s)).find(
    (n) => n !== null,
  );
  end.insertBefore(btn, neighbour ? neighbour.nextSibling : end.firstChild);
  syncButton(remainingMs());
}

/** Seam for tests: jsdom cannot navigate, and `location` cannot be spied on. */
export const navigation = {
  assign(url: string): void {
    location.assign(url);
  },
};

function buildPrompt(): HTMLElement {
  const box = document.createElement("div");
  box.className = PROMPT_CLASS;
  const heading = document.createElement("h2");
  heading.textContent = "What did you come here for?";
  const form = document.createElement("form");
  form.setAttribute("role", "search");
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Search YouTube";
  input.setAttribute("aria-label", "What did you come here for?");
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.title = "Search";
  submit.setAttribute("aria-label", "Search");
  submit.appendChild(makeSvgIcon(SEARCH_PATH_D, ICON_SIZE));
  form.append(input, submit);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) {
      input.focus();
      return;
    }
    navigation.assign(`/results?search_query=${encodeURIComponent(q)}`);
  });
  const note = document.createElement("p");
  note.textContent = "The feed is hidden. The eye button in the top bar shows it for a minute.";
  box.append(heading, form, note);
  return box;
}

/**
 * The home page's grid. YouTube keeps every visited feed's <ytd-browse>
 * alive, so with any of them in the page only the home one counts; a page
 * with none (the test fixtures) falls back to the first grid.
 */
function findHomeGrid(): HTMLElement | null {
  const home = document.querySelector<HTMLElement>(`${HOME_BROWSE_SELECTOR} ${GRID_SELECTOR}`);
  if (home || document.querySelector("ytd-browse")) return home;
  return document.querySelector<HTMLElement>(GRID_SELECTOR);
}

/**
 * Puts the prompt just before the home grid, once. YouTube keeps the home
 * page's element alive across in-app navigation, so one insert lasts; if
 * the grid is not there yet, waits for it.
 */
export function ensurePrompt(): void {
  if (document.querySelector(`.${PROMPT_CLASS}`)) return;
  const grid = findHomeGrid();
  if (!grid?.parentElement) {
    if (gridObserver || !document.body) return;
    gridObserver = new MutationObserver(() => {
      if (location.pathname === "/" && findHomeGrid()) ensurePrompt();
    });
    gridObserver.observe(document.body, { childList: true, subtree: true });
    return;
  }
  gridObserver?.disconnect();
  gridObserver = null;
  grid.parentElement.insertBefore(buildPrompt(), grid);
}

/**
 * Puts a one-line note just before the watch page's "Up next" list, once.
 * YouTube reuses the watch page's element from video to video, so one
 * insert lasts; if the list is not there yet, waits for it.
 */
export function ensureUpNextNote(): void {
  if (document.querySelector(`.${UPNEXT_NOTE_CLASS}`)) return;
  const list = document.querySelector<HTMLElement>(UPNEXT_SELECTOR);
  if (!list?.parentElement) {
    if (upNextObserver || !document.body) return;
    upNextObserver = new MutationObserver(() => {
      if (location.pathname === "/watch" && document.querySelector(UPNEXT_SELECTOR)) {
        ensureUpNextNote();
      }
    });
    upNextObserver.observe(document.body, { childList: true, subtree: true });
    return;
  }
  upNextObserver?.disconnect();
  upNextObserver = null;
  const note = document.createElement("p");
  note.className = UPNEXT_NOTE_CLASS;
  note.textContent = "Up next is hidden. The eye button in the top bar shows it for a minute.";
  list.parentElement.insertBefore(note, list);
}

/** Applies the stored state; safe to call on every navigation. */
export function initHiddenFeed(page: "home" | "watch" | null): void {
  shownUntil = Date.now() + peekRemaining(readStored(), Date.now());
  apply();
  ensureFeedToggle();
  if (page === "home") ensurePrompt();
  if (page === "watch") ensureUpNextNote();
  if (!storageListenerInstalled) {
    storageListenerInstalled = true;
    // Another youtube.com tab started or ended a peek: follow it.
    window.addEventListener("storage", (e) => {
      if (e.key !== SHOWN_UNTIL_KEY && e.key !== null) return;
      shownUntil = Date.now() + peekRemaining(readStored(), Date.now());
      apply();
    });
  }
}

/** Test hook: forgets module state between tests. */
export function resetHiddenFeedForTests(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
  mastheadObserver?.disconnect();
  mastheadObserver = null;
  gridObserver?.disconnect();
  gridObserver = null;
  upNextObserver?.disconnect();
  upNextObserver = null;
  shownUntil = 0;
}
