import { LOG_PREFIX } from "./log.js";

const tokenByVideoId = new Map<string, string>();

// In the 2026 view-model layout the lockup carries no `.data`. Tokens are
// embedded in `ytInitialData` (initial render) and in continuation responses
// (lazy-loaded scrolls). We walk both for any `{videoId, feedbackToken}`
// pair in the same subtree and key them by videoId, which we can recover
// from each lockup's `/watch?v=...` link.
export function buildInitialTokenMap(): void {
  if (!window.ytInitialData) return;
  const before = tokenByVideoId.size;
  collectTokens(window.ytInitialData);
  console.log(
    `${LOG_PREFIX} token map built from ytInitialData:`,
    tokenByVideoId.size - before,
    "new entries (total",
    tokenByVideoId.size + ")",
  );
}

export function collectTokens(root: unknown): void {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;

    const obj = node as Record<string, unknown>;
    if (typeof obj["feedbackToken"] === "string") {
      const videoId = videoIdFromFeedbackActions(obj);
      if (videoId && !tokenByVideoId.has(videoId)) {
        tokenByVideoId.set(videoId, obj["feedbackToken"] as string);
      }
    }

    if (Array.isArray(node)) {
      for (const child of node) stack.push(child);
    } else {
      for (const key in obj) stack.push(obj[key]);
    }
  }
}

// In the view-model layout, the videoId paired with a feedbackToken lives in
// the endpoint's `actions[]` array — under `hideItemSectionVideosByIdCommand`
// or `localWatchHistoryCommand`. Either is acceptable; we take the first.
export function videoIdFromFeedbackActions(
  feedbackEndpoint: Record<string, unknown>,
): string | null {
  const actions = feedbackEndpoint["actions"];
  if (!Array.isArray(actions)) return null;
  for (const action of actions) {
    if (!action || typeof action !== "object") continue;
    const cmd = action as {
      hideItemSectionVideosByIdCommand?: { videoId?: string };
      localWatchHistoryCommand?: { videoId?: string };
    };
    const vid =
      cmd.hideItemSectionVideosByIdCommand?.videoId ?? cmd.localWatchHistoryCommand?.videoId;
    if (vid) return vid;
  }
  return null;
}

export function getFeedbackToken(row: HTMLElement): string | null {
  const videoId = getVideoId(row);
  if (!videoId) return null;
  return tokenByVideoId.get(videoId) ?? null;
}

export function getVideoId(row: HTMLElement): string | null {
  const link = row.querySelector<HTMLAnchorElement>(
    'a[href*="watch?v="], a[href*="/shorts/"]',
  );
  if (!link) return null;
  const match = link.href.match(/(?:[?&]v=|\/shorts\/)([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

/** @internal — test helpers, not for production use. */
export function clearTokens(): void {
  tokenByVideoId.clear();
}

/** @internal */
export function tokenCount(): number {
  return tokenByVideoId.size;
}
