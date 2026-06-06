import { LOG_PREFIX } from "./log.js";
import { buildInitialTokenMap } from "./tokens.js";
import { patchFetchForContinuations } from "./fetch-patch.js";
import {
  decorateRow,
  decorateShelf,
  observeNewItems,
  HISTORY_ITEM_SELECTOR,
  SHELF_SELECTOR,
} from "./dom.js";

const HISTORY_PATH = "/feed/history";

let fetchPatched = false;
let observerStarted = false;

function isOnHistory(): boolean {
  return location.pathname === HISTORY_PATH;
}

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

function bootstrap(): void {
  if (!fetchPatched) {
    patchFetchForContinuations();
    fetchPatched = true;
  }
  if (isOnHistory()) activate();
}

bootstrap();

// YouTube is an SPA: navigating to /feed/history via the side nav does not
// reload the page, so the document_idle injection only fires on the first
// landing or a hard refresh. yt-navigate-finish is fired by YouTube's app
// shell after every client-side route change — re-activate when it lands on
// the history page.
window.addEventListener("yt-navigate-finish", () => {
  if (isOnHistory()) activate();
});
