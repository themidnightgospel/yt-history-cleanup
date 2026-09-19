import { LOG_PREFIX } from "./log.js";
import { buildInitialTokenMap } from "./tokens.js";
import { patchFetchForContinuations } from "./fetch-patch.js";
import {
  decorateRow,
  decorateShelf,
  observeNewItems,
  isOnHistory,
  HISTORY_ITEM_SELECTOR,
  SHELF_SELECTOR,
} from "./dom.js";
import { activateHomeFeed, isOnHome, restoreAllPlaceholders } from "./home-feed.js";
import { initGrayscale, pageKind } from "./grayscale.js";
import { initSpeedButtons } from "./speed.js";

let fetchPatched = false;
let observerStarted = false;

function activate(): void {
  console.log(
    `${LOG_PREFIX} activate at`,
    location.pathname,
    "ytInitialData?",
    typeof window.ytInitialData,
  );
  buildInitialTokenMap();
  const rows = document.querySelectorAll<HTMLElement>(HISTORY_ITEM_SELECTOR);
  console.log(`${LOG_PREFIX} scan found`, rows.length, "rows");
  rows.forEach(decorateRow);
  const shelves = document.querySelectorAll<HTMLElement>(SHELF_SELECTOR);
  console.log(`${LOG_PREFIX} scan found`, shelves.length, "shelves");
  shelves.forEach(decorateShelf);
  if (!observerStarted) {
    observeNewItems();
    observerStarted = true;
  }
}

function route(): void {
  // Page-independent: the CSS scopes grayscale to home and watch pages, and
  // the masthead toggle should exist everywhere.
  initGrayscale();
  initSpeedButtons(pageKind(location.pathname) === "watch");
  if (isOnHistory()) activate();
  else if (isOnHome()) activateHomeFeed();
}

function bootstrap(): void {
  if (!fetchPatched) {
    patchFetchForContinuations();
    fetchPatched = true;
  }
  route();
}

bootstrap();

// YouTube is an SPA: navigating to /feed/history or back home via the side
// nav does not reload the page, so the document_idle injection only fires on
// the first landing or a hard refresh. yt-navigate-finish is fired by
// YouTube's app shell after every client-side route change — re-route when
// it lands.
window.addEventListener("yt-navigate-finish", () => {
  restoreAllPlaceholders();
  route();
});
