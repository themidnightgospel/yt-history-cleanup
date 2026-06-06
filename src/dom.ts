import { LOG_PREFIX } from "./log.js";
import { deleteHistoryItem } from "./api.js";
import { getFeedbackToken } from "./tokens.js";

const HISTORY_ITEM_SELECTORS = ["yt-lockup-view-model", "ytd-video-renderer"];
export const HISTORY_ITEM_SELECTOR = HISTORY_ITEM_SELECTORS.join(",");
const SVG_NS = "http://www.w3.org/2000/svg";
const TRASH_PATH_D =
  "M9 3v1H4v2h1v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6h1V4h-5V3H9zm0 5h2v10H9V8zm4 0h2v10h-2V8z";
const TOAST_LIFETIME_MS = 4000;

// YouTube's CSP enforces Trusted Types; setting `innerHTML` to a raw string
// throws. Build SVG nodes via DOM APIs instead.
export function makeTrashIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", TRASH_PATH_D);
  svg.appendChild(path);
  return svg;
}

export function observeNewItems(): void {
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.matches(HISTORY_ITEM_SELECTOR)) decorateRow(node);
        node.querySelectorAll<HTMLElement>(HISTORY_ITEM_SELECTOR).forEach(decorateRow);
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function decorateRow(row: HTMLElement): void {
  if (row.dataset["ythcDecorated"] === "1") return;
  row.dataset["ythcDecorated"] = "1";
  row.style.position = "relative";
  insertDeleteButton(row);
}

export function insertDeleteButton(row: HTMLElement): void {
  const btn = document.createElement("button");
  btn.className = "ythc-delete-btn";
  btn.title = "Delete from history";
  btn.setAttribute("aria-label", "Delete from history");
  btn.appendChild(makeTrashIcon());
  btn.addEventListener("click", (e) => onDeleteClick(e, row));
  row.appendChild(btn);
}

export async function onDeleteClick(e: MouseEvent, row: HTMLElement): Promise<void> {
  e.stopPropagation();
  e.preventDefault();
  const token = getFeedbackToken(row);
  if (!token) {
    console.warn(`${LOG_PREFIX} no token for row`, row);
    showToast("Could not find token — try scrolling and retry.");
    return;
  }
  row.remove();
  try {
    await deleteHistoryItem(token);
  } catch (err) {
    console.warn(`${LOG_PREFIX} delete failed`, err);
    showToast("Failed to delete on YouTube. Refresh to verify.");
  }
}

export function showToast(message: string): void {
  const t = document.createElement("div");
  t.className = "ythc-toast";
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), TOAST_LIFETIME_MS);
}
