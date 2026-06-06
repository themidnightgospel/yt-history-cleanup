import { LOG_PREFIX } from "./log.js";
import { buildInitialTokenMap } from "./tokens.js";
import { patchFetchForContinuations } from "./fetch-patch.js";
import { decorateRow, observeNewItems, HISTORY_ITEM_SELECTOR } from "./dom.js";

function main(): void {
  console.log(
    `${LOG_PREFIX} content script loaded at`,
    location.pathname,
    "ytInitialData?",
    typeof window.ytInitialData,
  );
  buildInitialTokenMap();
  patchFetchForContinuations();
  const initial = document.querySelectorAll<HTMLElement>(HISTORY_ITEM_SELECTOR);
  console.log(`${LOG_PREFIX} initial scan found`, initial.length, "rows");
  initial.forEach(decorateRow);
  observeNewItems();
}

main();
