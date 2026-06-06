import { LOG_PREFIX } from "./log.js";
import { deleteHistoryItem } from "./api.js";
import { getChannelId, getFeedbackToken, getVideoId } from "./tokens.js";
import { parseSectionDate, daysAgo } from "./dates.js";
import { makeTrashIcon, showToast } from "./dom-shared.js";

const VIDEO_LINK_SELECTOR = 'a[href*="watch?v="]';
const METADATA_ROW_SELECTOR = ".ytContentMetadataViewModelMetadataRow";
const AVATAR_LABEL_SELECTOR = "[aria-label^='Go to channel ']";
const SECTION_SELECTOR = "ytd-item-section-renderer";
const SECTION_TITLE_SELECTOR = "h2#title";
const ROW_SELECTOR = "yt-lockup-view-model, ytd-video-renderer";

const DAYS_OPTIONS: ReadonlyArray<{ label: string; days: number }> = [
  { label: "Today", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last year", days: 365 },
  { label: "All time", days: Number.POSITIVE_INFINITY },
];

const CHANNEL_DELETE_CHUNK_SIZE = 5;
const CHANNEL_SCROLL_WAIT_MS = 4000;
const CHANNEL_MAX_SCROLL_ROUNDS = 200;
const CHANNEL_DELETE_ICON_SIZE = 18;

let channelDeleteInProgress = false;

// Clear the flag on real page unload (refresh, tab close, cross-origin nav).
// Does NOT cover SPA navigation within YouTube; if YT's client-side router
// drops a content-script realm without unloading the page, a stuck flag
// will block the next channel-delete until refresh.
window.addEventListener("beforeunload", () => {
  channelDeleteInProgress = false;
});

export function tryDecorateChannelButton(row: HTMLElement): void {
  if (row.dataset["ythcChannelDecorated"] === "1") return;
  // Skip non-video rows (shorts have /shorts/ links, not /watch?v=).
  if (!row.querySelector(VIDEO_LINK_SELECTOR)) return;
  const metadataRow = row.querySelector<HTMLElement>(METADATA_ROW_SELECTOR);
  if (!metadataRow) return;
  row.dataset["ythcChannelDecorated"] = "1";
  insertChannelDeleteButton(row, metadataRow);
}

function insertChannelDeleteButton(row: HTMLElement, metadataRow: HTMLElement): void {
  const btn = document.createElement("button");
  btn.className = "ythc-channel-delete-btn";
  btn.title = "Delete all videos of this channel";
  btn.setAttribute("aria-label", "Delete all videos of this channel");
  btn.appendChild(makeTrashIcon(CHANNEL_DELETE_ICON_SIZE));
  btn.addEventListener("click", (e) => onChannelDeleteClick(e, row));
  metadataRow.appendChild(btn);
}

export async function onChannelDeleteClick(e: MouseEvent, row: HTMLElement): Promise<void> {
  e.stopPropagation();
  e.preventDefault();
  if (channelDeleteInProgress) {
    showToast("Another channel delete is in progress.");
    return;
  }
  const channelId = getChannelId(row);
  if (!channelId) {
    showToast("Could not find channel info — try scrolling and retry.");
    return;
  }
  const displayName = extractChannelDisplayName(row) ?? "this channel";
  openChannelDeleteDialog(channelId, displayName);
}

/** @internal — exported for tests; treat as module-private otherwise. */
export function extractChannelDisplayName(row: HTMLElement): string | null {
  const avatar = row.querySelector<HTMLElement>(AVATAR_LABEL_SELECTOR);
  if (avatar) {
    const label = avatar.getAttribute("aria-label") ?? "";
    const m = label.match(/^Go to channel\s+(.+)$/);
    if (m?.[1]) return m[1].trim();
  }
  const metadataRow = row.querySelector<HTMLElement>(METADATA_ROW_SELECTOR);
  const span = metadataRow?.querySelector("span");
  return span?.textContent?.trim() ?? null;
}

export function openChannelDeleteDialog(channelId: string, displayName: string): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.className = "ythc-channel-dialog";

  const title = document.createElement("h2");
  title.className = "ythc-channel-dialog-title";
  title.textContent = `Delete all videos of "${displayName}"`;

  const form = document.createElement("div");
  form.className = "ythc-channel-dialog-form";

  const label = document.createElement("label");
  label.className = "ythc-channel-dialog-label";
  label.textContent = "From: ";

  const select = document.createElement("select");
  select.className = "ythc-channel-dialog-select";
  for (const opt of DAYS_OPTIONS) {
    const o = document.createElement("option");
    o.value = String(opt.days);
    o.textContent = opt.label;
    select.appendChild(o);
  }
  label.appendChild(select);
  form.appendChild(label);

  const formActions = document.createElement("div");
  formActions.className = "ythc-channel-dialog-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "ythc-channel-dialog-btn";
  cancelBtn.textContent = "Cancel";

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "ythc-channel-dialog-btn ythc-channel-dialog-btn-danger";
  confirmBtn.textContent = "Confirm";

  formActions.append(cancelBtn, confirmBtn);
  form.appendChild(formActions);

  const progress = document.createElement("div");
  progress.className = "ythc-channel-dialog-progress";
  progress.hidden = true;

  const counter = document.createElement("div");
  counter.className = "ythc-channel-dialog-counter";

  const progressActions = document.createElement("div");
  progressActions.className = "ythc-channel-dialog-actions";

  const progressCancelBtn = document.createElement("button");
  progressCancelBtn.type = "button";
  progressCancelBtn.className = "ythc-channel-dialog-btn";
  progressCancelBtn.textContent = "Cancel";

  progressActions.appendChild(progressCancelBtn);
  progress.append(counter, progressActions);

  dialog.append(title, form, progress);
  document.body.appendChild(dialog);
  // jsdom doesn't implement showModal; fall back to the `open` attribute
  // so unit tests can drive the dialog without polyfilling.
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");

  cancelBtn.addEventListener("click", () => closeAndRemove(dialog));

  confirmBtn.addEventListener("click", async () => {
    if (channelDeleteInProgress) return;
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    const days = Number(select.value);
    form.hidden = true;
    progress.hidden = false;
    counter.textContent = "Starting…";

    const cancelFlag = { canceled: false };
    progressCancelBtn.addEventListener("click", () => {
      cancelFlag.canceled = true;
      progressCancelBtn.disabled = true;
      progressCancelBtn.textContent = "Cancelling…";
    });

    channelDeleteInProgress = true;
    try {
      const result = await runChannelDelete(channelId, days, counter, cancelFlag);
      counter.textContent = `Done. Deleted ${result.ok}. Failed ${result.failed}.${
        cancelFlag.canceled ? " (Cancelled.)" : ""
      }`;
      progressCancelBtn.disabled = false;
      progressCancelBtn.textContent = "Close";
      progressCancelBtn.replaceWith(makeCloseButton(dialog));
    } catch (err) {
      console.warn(`${LOG_PREFIX} channel delete error`, err);
      counter.textContent = `Error: ${(err as Error).message}`;
      progressCancelBtn.disabled = false;
      progressCancelBtn.textContent = "Close";
      progressCancelBtn.replaceWith(makeCloseButton(dialog));
    } finally {
      channelDeleteInProgress = false;
    }
  });

  return dialog;
}

function makeCloseButton(dialog: HTMLDialogElement): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ythc-channel-dialog-btn";
  btn.textContent = "Close";
  btn.addEventListener("click", () => closeAndRemove(dialog));
  return btn;
}

function closeAndRemove(dialog: HTMLDialogElement): void {
  try {
    if (dialog.open && typeof dialog.close === "function") dialog.close();
  } catch {
    // jsdom test environment lacks dialog APIs — silent fallback.
  }
  dialog.remove();
}

// Iterates through loaded sections (newest → oldest), deletes channel
// matches in those within the day cutoff, and scrolls the page when the
// loaded set is exhausted. Stops at the first section older than the
// cutoff, when no new content loads, when capped, or when cancelled.
/** @internal — exported for tests; treat as module-private otherwise. */
export async function runChannelDelete(
  channelId: string,
  maxDaysOld: number,
  counter: HTMLElement,
  cancelFlag: { canceled: boolean },
): Promise<{ ok: number; failed: number }> {
  const now = new Date();
  let ok = 0;
  let failed = 0;
  const consumedSections = new WeakSet<Element>();

  const tick = (status: string): void => {
    counter.textContent = `${status} — Deleted ${ok}. Failed ${failed}.`;
  };

  for (let round = 0; round < CHANNEL_MAX_SCROLL_ROUNDS; round++) {
    if (cancelFlag.canceled) break;

    const sections = Array.from(
      document.querySelectorAll<HTMLElement>(SECTION_SELECTOR),
    );
    let anyDeletedThisRound = false;
    let pastCutoff = false;

    for (const section of sections) {
      if (cancelFlag.canceled) break;
      if (consumedSections.has(section)) continue;
      const titleEl = section.querySelector<HTMLElement>(SECTION_TITLE_SELECTOR);
      const title = titleEl?.textContent?.trim() ?? "";
      const sectionDate = parseSectionDate(title, now);
      if (!sectionDate) {
        // Unparseable header (e.g. localized) — skip but don't mark consumed
        // so future iterations might revisit if labels load late.
        continue;
      }
      const ageDays = daysAgo(sectionDate, now);
      if (ageDays > maxDaysOld) {
        pastCutoff = true;
        break;
      }
      const matches = findChannelMatchesInSection(section, channelId);
      consumedSections.add(section);
      if (matches.length === 0) continue;

      tick(`Section ${title}: deleting ${matches.length}…`);
      const r = await chunkedChannelDelete(matches, cancelFlag);
      ok += r.ok;
      failed += r.failed;
      anyDeletedThisRound = true;
      tick(`Section ${title}: done.`);
    }

    if (pastCutoff || cancelFlag.canceled) break;

    tick("Loading more history…");
    const grew = await scrollAndWaitForNewSections(sections.length);
    if (!grew && !anyDeletedThisRound) break;
  }

  return { ok, failed };
}

function findChannelMatchesInSection(section: Element, channelId: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const row of section.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
    if (!row.querySelector(VIDEO_LINK_SELECTOR)) continue; // skip shorts
    if (getChannelId(row) !== channelId) continue;
    out.push(row);
  }
  return out;
}

// Cancel is honored at chunk boundaries only; up to CHANNEL_DELETE_CHUNK_SIZE
// deletes may complete after Cancel is clicked.
async function chunkedChannelDelete(
  rows: HTMLElement[],
  cancelFlag: { canceled: boolean },
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += CHANNEL_DELETE_CHUNK_SIZE) {
    if (cancelFlag.canceled) break;
    const chunk = rows.slice(i, i + CHANNEL_DELETE_CHUNK_SIZE);
    const results = await Promise.allSettled(chunk.map((row) => deleteOneRow(row)));
    for (const r of results) {
      if (r.status === "fulfilled") ok++;
      else failed++;
    }
  }
  return { ok, failed };
}

async function deleteOneRow(row: HTMLElement): Promise<void> {
  const token = getFeedbackToken(row);
  if (!token) {
    const vid = getVideoId(row);
    throw new Error(`no token for row ${vid ?? "?"}`);
  }
  row.remove();
  await deleteHistoryItem(token);
}

function scrollAndWaitForNewSections(beforeCount: number): Promise<boolean> {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" as ScrollBehavior });
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => {
      const now = document.querySelectorAll(SECTION_SELECTOR).length;
      if (now > beforeCount) {
        obs.disconnect();
        clearTimeout(timer);
        resolve(true);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => {
      obs.disconnect();
      resolve(false);
    }, CHANNEL_SCROLL_WAIT_MS);
  });
}

/** @internal */
export function isChannelDeleteInProgress(): boolean {
  return channelDeleteInProgress;
}

/** @internal — test-only reset. */
export function resetChannelDeleteState(): void {
  channelDeleteInProgress = false;
}
