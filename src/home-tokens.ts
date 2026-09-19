// Home-feed cards carry two feedback actions in their 3-dot menu:
// "Not interested" and "Don't recommend channel". Each is a feedbackToken
// with no videoId inside its endpoint (unlike history tokens), so we key
// them by the card's own id instead: `contentId` on a lockupViewModel, or
// `videoId` on a classic videoRenderer. The menu item's label is the
// nearest enclosing `text` / `title` node, in either the classic
// (`menuServiceItemRenderer.text.runs`) or view-model
// (`listItemViewModel.title.content`) shape.

export type FeedbackAction = "notInterested" | "dontRecommendChannel";

export const ACTION_LABELS: Record<FeedbackAction, RegExp> = {
  notInterested: /^not interested$/i,
  dontRecommendChannel: /^don.?t recommend channel$/i,
};

/** Matches the "Undo" button label in a feedback response. */
export const UNDO_LABEL = /^undo$/i;

type ActionTokens = Partial<Record<FeedbackAction, string>>;

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const MAX_DEPTH = 64;

const actionsByVideoId = new Map<string, ActionTokens>();

export function buildInitialHomeTokenMap(): void {
  if (!window.ytInitialData) return;
  collectHomeTokens(window.ytInitialData);
}

// Walk any InnerTube payload (ytInitialData or a browse continuation), find
// each card, and register the labeled feedback tokens found in its subtree.
export function collectHomeTokens(root: unknown): void {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    const obj = node as Record<string, unknown>;

    const id = cardId(obj);
    if (id) {
      const found = labeledTokensIn(obj);
      const tokens: ActionTokens = {};
      for (const action of Object.keys(ACTION_LABELS) as FeedbackAction[]) {
        const hit = found.find((t) => ACTION_LABELS[action].test(t.label.trim()));
        if (hit) tokens[action] = hit.token;
      }
      // Merge per action, newest payload wins: the same video can appear in
      // a shorts shelf (Not interested only) and in the grid (both), and
      // YouTube issues fresh tokens on every render.
      if (Object.keys(tokens).length > 0) {
        actionsByVideoId.set(id, { ...actionsByVideoId.get(id), ...tokens });
      }
    }

    if (Array.isArray(node)) for (const c of node) stack.push(c);
    else for (const k in obj) stack.push(obj[k]);
  }
}

function cardId(obj: Record<string, unknown>): string | null {
  const cid = obj["contentId"];
  if (typeof cid === "string" && VIDEO_ID_RE.test(cid)) return cid;
  // Classic renderers: `videoId` appears in many endpoint objects too, so
  // require the menu to be present to treat this node as a card.
  const vid = obj["videoId"];
  if (typeof vid === "string" && VIDEO_ID_RE.test(vid) && "menu" in obj) return vid;
  // Shorts lockups carry their menu as `menuOnTap` and their id inside the
  // tap command's reelWatchEndpoint rather than a top-level contentId.
  if ("menuOnTap" in obj) return findVideoIdInSubtree(obj["onTap"]);
  return null;
}

function findVideoIdInSubtree(root: unknown): string | null {
  const stack: unknown[] = [root];
  let steps = 0;
  while (stack.length > 0 && steps++ < 200) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    const obj = node as Record<string, unknown>;
    for (const key of ["reelWatchEndpoint", "watchEndpoint"]) {
      const ep = obj[key];
      if (ep && typeof ep === "object") {
        const vid = (ep as Record<string, unknown>)["videoId"];
        if (typeof vid === "string" && VIDEO_ID_RE.test(vid)) return vid;
      }
    }
    if (Array.isArray(node)) for (const c of node) stack.push(c);
    else for (const k in obj) stack.push(obj[k]);
  }
  return null;
}

export type LabeledToken = { label: string; token: string };

// Depth-first walk that carries the closest enclosing label down to every
// feedbackToken beneath it. Cycle-safe via `seen`. Children are pushed in
// reverse so tokens come out in document order.
export function labeledTokensIn(root: unknown): LabeledToken[] {
  const out: LabeledToken[] = [];
  const seen = new Set<object>();
  const stack: Array<{ node: unknown; label: string; depth: number }> = [
    { node: root, label: "", depth: 0 },
  ];
  while (stack.length > 0) {
    const { node, label: inherited, depth } = stack.pop()!;
    if (!node || typeof node !== "object" || depth > MAX_DEPTH) continue;
    if (seen.has(node)) continue;
    seen.add(node);

    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        stack.push({ node: node[i], label: inherited, depth: depth + 1 });
      }
      continue;
    }

    const obj = node as Record<string, unknown>;
    const label = labelOf(obj) ?? inherited;

    const fe = obj["feedbackEndpoint"];
    if (fe && typeof fe === "object") {
      const token = (fe as Record<string, unknown>)["feedbackToken"];
      if (typeof token === "string") out.push({ label, token });
    }

    const keys = Object.keys(obj);
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i]!;
      if (k === "text" || k === "title") continue;
      stack.push({ node: obj[k], label, depth: depth + 1 });
    }
  }
  return out;
}

function labelOf(obj: Record<string, unknown>): string | null {
  for (const key of ["text", "title"]) {
    const t = obj[key];
    // View-model buttons carry a plain string title ("Undo").
    if (typeof t === "string") return t;
    if (!t || typeof t !== "object") continue;
    const rec = t as Record<string, unknown>;
    if (typeof rec["simpleText"] === "string") return rec["simpleText"];
    if (typeof rec["content"] === "string") return rec["content"];
    const runs = rec["runs"];
    if (Array.isArray(runs)) {
      return runs
        .map((r) => {
          const text = r && typeof r === "object" ? (r as Record<string, unknown>)["text"] : null;
          return typeof text === "string" ? text : "";
        })
        .join("");
    }
  }
  return null;
}

/** First feedback token in a payload whose label matches `pattern`. */
export function findLabeledToken(root: unknown, pattern: RegExp): string | null {
  const hit = labeledTokensIn(root).find((t) => pattern.test(t.label.trim()));
  return hit?.token ?? null;
}

// A playlist or mix card links to `/watch?v=<first video>&list=...`; keying
// it by that video would let it borrow a real video card's tokens. Only
// links without a list parameter identify a card.
export function getHomeVideoId(card: HTMLElement): string | null {
  const links = card.querySelectorAll<HTMLAnchorElement>(
    'a[href*="watch?v="], a[href*="/shorts/"]',
  );
  for (const link of links) {
    if (/[?&]list=/.test(link.href)) continue;
    const match = link.href.match(/(?:[?&]v=|\/shorts\/)([A-Za-z0-9_-]+)/);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function getHomeToken(card: HTMLElement, action: FeedbackAction): string | null {
  const videoId = getHomeVideoId(card);
  if (!videoId) return null;
  return actionsByVideoId.get(videoId)?.[action] ?? null;
}

/** @internal — test helpers, not for production use. */
export function clearHomeTokens(): void {
  actionsByVideoId.clear();
}

/** @internal */
export function homeTokenCount(): number {
  return actionsByVideoId.size;
}
