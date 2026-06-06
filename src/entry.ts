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

function main(): void {
  console.log(
    `${LOG_PREFIX} content script loaded at`,
    location.pathname,
    "ytInitialData?",
    typeof window.ytInitialData,
  );
  buildInitialTokenMap();
  patchFetchForContinuations();
  const initialRows = document.querySelectorAll<HTMLElement>(HISTORY_ITEM_SELECTOR);
  console.log(`${LOG_PREFIX} initial scan found`, initialRows.length, "rows");
  initialRows.forEach(decorateRow);
  const initialShelves = document.querySelectorAll<HTMLElement>(SHELF_SELECTOR);
  console.log(`${LOG_PREFIX} initial scan found`, initialShelves.length, "shelves");
  initialShelves.forEach(decorateShelf);
  observeNewItems();
}

main();
