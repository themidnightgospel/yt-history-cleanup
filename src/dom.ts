import { LOG_PREFIX } from "./log.js";
import { deleteHistoryItem } from "./api.js";
import { getFeedbackToken } from "./tokens.js";

const SHORTS_LOCKUP_SELECTOR =
  "ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2";
export const SHELF_SELECTOR = "ytd-reel-shelf-renderer";
const SHELF_DELETE_CHUNK_SIZE = 5;
const SHELF_WAIT_FOR_NEW_CARDS_MS = 3000;
const SHELF_LOOP_MAX_ROUNDS = 50;

const HISTORY_ITEM_SELECTORS = [
  // standard rows (videos and shorts shown as full-width rows)
  "yt-lockup-view-model",
  "ytd-video-renderer",
  // shelf items (shorts grouped inside a ytd-reel-shelf-renderer)
  "ytm-shorts-lockup-view-model",
  "ytm-shorts-lockup-view-model-v2",
];
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
        if (node.matches(SHELF_SELECTOR)) decorateShelf(node);
        node.querySelectorAll<HTMLElement>(SHELF_SELECTOR).forEach(decorateShelf);
        // A shorts card may arrive after its shelf was already created empty
        // (lazy-load case). Retry shelf decoration via the card's ancestor.
        if (node.matches(SHORTS_LOCKUP_SELECTOR)) {
          const ancestor = node.closest(SHELF_SELECTOR);
          if (ancestor instanceof HTMLElement) decorateShelf(ancestor);
        }
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function decorateRow(row: HTMLElement): void {
  if (row.dataset["ythcDecorated"] === "1") return;
  // Shorts shelf items can nest one history-item tag inside another
  // (`<ytm-shorts-lockup-view-model><ytm-shorts-lockup-view-model-v2>...`).
  // Skip the inner match so we render exactly one button per visible card.
  if (row.parentElement?.closest(HISTORY_ITEM_SELECTOR)) return;
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
  // Must remain a child of `row`: content.css `.shortsLockupViewModelHost
  // .ythc-delete-btn` selector relies on this for shelf-item positioning.
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
  const shelf = row.closest("ytd-reel-shelf-renderer");
  row.remove();
  // Only advance when the shelf is empty in the DOM — otherwise YT pages by
  // the full visible window and skips siblings the user still wants to see.
  if (shelf && shelf.querySelectorAll(SHORTS_LOCKUP_SELECTOR).length === 0) {
    advanceReelShelf(shelf);
  }
  try {
    await deleteHistoryItem(token);
  } catch (err) {
    console.warn(`${LOG_PREFIX} delete failed`, err);
    showToast("Failed to delete on YouTube. Refresh to verify.");
  }
}

// YT shelves render ~6 cards at a time; removing a visible card leaves a hole
// until the user clicks the shelf's right-arrow. Click it for them so the
// next batch slides in and stays decoratable.
function advanceReelShelf(shelf: Element): void {
  // YT pages by a full visible window — clicking Next alone skips ahead past
  // the next batch. Click Next to trigger the continuation fetch (so new
  // shorts populate the DOM), then click Previous to bring the carousel back
  // to the now-newly-populated visible window.
  const next = findShelfArrow(shelf, "Next", "#right-arrow");
  if (!next) return;
  next.click();
  const prev = findShelfArrow(shelf, "Previous", "#left-arrow");
  prev?.click();
}

function findShelfArrow(
  shelf: Element,
  label: "Next" | "Previous",
  idSelector: string,
): HTMLElement | null {
  const arrow = shelf.querySelector<HTMLElement>(
    `${idSelector} button, button[aria-label="${label}"], button[aria-label*="${label}" i]`,
  );
  if (!arrow) return null;
  if (arrow.hasAttribute("disabled")) return null;
  if (arrow.getAttribute("aria-disabled") === "true") return null;
  return arrow;
}

export function decorateShelf(shelf: HTMLElement): void {
  if (shelf.dataset["ythcShelfDecorated"] === "1") return;
  // YouTube uses <ytd-reel-shelf-renderer> elsewhere (subscriptions panels,
  // recommendations) — only decorate when the shelf actually contains shorts
  // lockups. If the shelf is created empty and shorts arrive later, the
  // observer re-attempts decoration via the SHORTS_LOCKUP path.
  if (!shelf.querySelector(SHORTS_LOCKUP_SELECTOR)) return;
  const menu = shelf.querySelector<HTMLElement>("#header > #menu");
  if (!menu) return;
  shelf.dataset["ythcShelfDecorated"] = "1";
  insertShelfDeleteButton(shelf, menu);
}

export function insertShelfDeleteButton(shelf: HTMLElement, menu: HTMLElement): void {
  const btn = document.createElement("button");
  btn.className = "ythc-shelf-delete-btn";
  btn.title = "Delete all shorts in this group";
  btn.setAttribute("aria-label", "Delete all shorts in this group");
  btn.appendChild(makeTrashIcon());
  btn.addEventListener("click", (e) => onShelfDeleteClick(e, shelf));
  menu.parentElement?.insertBefore(btn, menu);
}

export async function onShelfDeleteClick(e: MouseEvent, shelf: HTMLElement): Promise<void> {
  e.stopPropagation();
  e.preventDefault();
  let ok = 0;
  let failed = 0;

  for (let round = 0; round < SHELF_LOOP_MAX_ROUNDS; round++) {
    const next = findShelfArrow(shelf, "Next", "#right-arrow");
    const cards = Array.from(shelf.querySelectorAll<HTMLElement>(SHORTS_LOCKUP_SELECTOR));
    // Leave one card per round to keep the shelf from collapsing — without a
    // surviving card YT removes the right-arrow and we lose access to the
    // remaining pages. On the final page (`next` disabled) we delete the lot.
    const toDelete = next ? cards.slice(0, -1) : cards;
    if (toDelete.length === 0 && !next) break;

    const result = await chunkedShelfDelete(toDelete);
    ok += result.ok;
    failed += result.failed;

    if (!next) break;
    next.click();
    const grew = await waitForNewCards(shelf, SHELF_WAIT_FOR_NEW_CARDS_MS);
    if (!grew) {
      // Right-arrow was enabled but no new cards loaded within the timeout.
      // Treat the surviving kept-card(s) as the final batch and clear them
      // — otherwise the user is left with a stranded card and no toast.
      const stranded = Array.from(
        shelf.querySelectorAll<HTMLElement>(SHORTS_LOCKUP_SELECTOR),
      );
      const tail = await chunkedShelfDelete(stranded);
      ok += tail.ok;
      failed += tail.failed;
      break;
    }
  }

  if (failed > 0) showToast(`Deleted ${ok}. Failed ${failed}.`);
}

async function chunkedShelfDelete(
  cards: HTMLElement[],
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < cards.length; i += SHELF_DELETE_CHUNK_SIZE) {
    const chunk = cards.slice(i, i + SHELF_DELETE_CHUNK_SIZE);
    const results = await Promise.allSettled(chunk.map((card) => deleteOneCard(card)));
    for (const r of results) {
      if (r.status === "fulfilled") ok++;
      else failed++;
    }
  }
  return { ok, failed };
}

async function deleteOneCard(card: HTMLElement): Promise<void> {
  const token = getFeedbackToken(card);
  if (!token) throw new Error("no token for card");
  card.remove();
  await deleteHistoryItem(token);
}

function waitForNewCards(shelf: HTMLElement, timeoutMs: number): Promise<boolean> {
  const before = shelf.querySelectorAll(SHORTS_LOCKUP_SELECTOR).length;
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => {
      const now = shelf.querySelectorAll(SHORTS_LOCKUP_SELECTOR).length;
      if (now > before) {
        obs.disconnect();
        resolve(true);
      }
    });
    obs.observe(shelf, { childList: true, subtree: true });
    setTimeout(() => {
      obs.disconnect();
      resolve(false);
    }, timeoutMs);
  });
}

export function showToast(message: string): void {
  const t = document.createElement("div");
  t.className = "ythc-toast";
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), TOAST_LIFETIME_MS);
}
