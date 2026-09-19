import { LOG_PREFIX } from "./log.js";
import { postFeedback } from "./api.js";
import { getVideoId } from "./tokens.js";
import {
  ACTION_LABELS,
  UNDO_LABEL,
  buildInitialHomeTokenMap,
  findLabeledToken,
  getHomeToken,
  type FeedbackAction,
} from "./home-tokens.js";
import { makeSvgIcon, showToast } from "./dom-shared.js";

// A `home feed card` is one ytd-rich-item-renderer on youtube.com/ — it
// wraps a lockup (video, short, mix, playlist) plus its 3-dot menu.
export const HOME_CARD_SELECTOR = "ytd-rich-item-renderer";

// Where the action buttons go. First match wins; the host is made
// position:relative so the button box can sit in its top-right corner.
const THUMB_HOST_SELECTOR = [
  "ytd-thumbnail",
  "ytd-playlist-thumbnail",
  "yt-thumbnail-view-model",
  ".yt-lockup-view-model__content-image",
  ".shortsLockupViewModelHostThumbnailContainer",
].join(",");

const BOX_CLASS = "ythc-fb-box";
const BTN_CLASS = "ythc-fb-btn";
const PLACEHOLDER_CLASS = "ythc-removed";
const ICON_SIZE = 18;

type ActionSpec = { label: string; removedText: string; iconPath: string };

const ACTIONS: Record<FeedbackAction, ActionSpec> = {
  notInterested: {
    label: "Not interested",
    removedText: "Video removed",
    // Material "visibility_off"
    iconPath:
      "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z",
  },
  dontRecommendChannel: {
    label: "Don't recommend channel",
    removedText: "We won't recommend videos from this channel",
    // Material "block"
    iconPath:
      "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9C4.63 15.55 4 13.85 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1C19.37 8.45 20 10.15 20 12c0 4.42-3.58 8-8 8z",
  },
};

const ACTION_ORDER: FeedbackAction[] = ["notInterested", "dontRecommendChannel"];

// ---------------------------------------------------------------------------
// Decoration

// Idempotent: adds the button box on first sight, then adds any button whose
// token has since become known (continuations land after the card renders).
// If YouTube re-binds the element to another video, the box is rebuilt.
export function decorateHomeCard(card: HTMLElement): void {
  const videoId = getVideoId(card);
  if (!videoId) return;

  const placeholder = placeholders.get(card);
  if (placeholder) {
    if (placeholder.videoId !== videoId) placeholder.restore();
    return;
  }

  let box = card.querySelector<HTMLElement>(`.${BOX_CLASS}`);
  if (box && box.dataset["videoId"] !== videoId) {
    box.remove();
    box = null;
  }
  if (!box) {
    const host = card.querySelector<HTMLElement>(THUMB_HOST_SELECTOR);
    if (!host) return;
    host.style.position = "relative";
    box = document.createElement("div");
    box.className = BOX_CLASS;
    box.dataset["videoId"] = videoId;
    host.appendChild(box);
  }

  for (const action of ACTION_ORDER) {
    if (box.querySelector(`[data-action="${action}"]`)) continue;
    if (!getHomeToken(card, action)) continue;
    box.appendChild(makeActionButton(card, action));
  }
}

function makeActionButton(card: HTMLElement, action: FeedbackAction): HTMLButtonElement {
  const spec = ACTIONS[action];
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = BTN_CLASS;
  btn.dataset["action"] = action;
  btn.title = spec.label;
  btn.setAttribute("aria-label", spec.label);
  btn.appendChild(makeSvgIcon(spec.iconPath, ICON_SIZE));
  btn.addEventListener("click", (e) => onFeedbackClick(e, card, action));
  // The whole lockup is a link in the view-model layout; keep pointer
  // events from starting a navigation or the inline preview.
  for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup"]) {
    btn.addEventListener(type, (e) => e.stopPropagation());
  }
  return btn;
}

export function decorateAllHomeCards(): void {
  document.querySelectorAll<HTMLElement>(HOME_CARD_SELECTOR).forEach(decorateHomeCard);
}

// ---------------------------------------------------------------------------
// Placeholder (mirrors YouTube's own "Video removed / Undo" card)

type Placeholder = { videoId: string; restore: () => void; onUndo: () => void };

const placeholders = new Map<HTMLElement, Placeholder>();

export function showRemovedPlaceholder(
  card: HTMLElement,
  videoId: string,
  text: string,
): Placeholder {
  const content = card.querySelector<HTMLElement>(":scope > #content") ?? card;
  const height = content.offsetHeight;

  const hidden: Array<{ el: HTMLElement; display: string }> = [];
  for (const child of Array.from(content.children)) {
    if (!(child instanceof HTMLElement)) continue;
    hidden.push({ el: child, display: child.style.display });
    child.style.display = "none";
  }

  const box = document.createElement("div");
  box.className = PLACEHOLDER_CLASS;
  if (height > 0) box.style.minHeight = `${height}px`;

  const msg = document.createElement("div");
  msg.className = `${PLACEHOLDER_CLASS}-msg`;
  msg.textContent = text;

  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = `${PLACEHOLDER_CLASS}-undo`;
  undo.textContent = "Undo";

  box.appendChild(msg);
  box.appendChild(undo);
  content.appendChild(box);

  const placeholder: Placeholder = {
    videoId,
    onUndo: () => {},
    restore: () => {
      if (!placeholders.has(card)) return;
      placeholders.delete(card);
      box.remove();
      for (const { el, display } of hidden) el.style.display = display;
    },
  };
  undo.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    placeholder.onUndo();
  });
  placeholders.set(card, placeholder);
  return placeholder;
}

// Any navigation drops the placeholders: the feed reloads without those
// videos anyway, and a recycled card element must not keep a stale one.
export function restoreAllPlaceholders(): void {
  for (const p of Array.from(placeholders.values())) p.restore();
}

// ---------------------------------------------------------------------------
// Click handling

export async function onFeedbackClick(
  e: MouseEvent,
  card: HTMLElement,
  action: FeedbackAction,
): Promise<void> {
  e.stopPropagation();
  e.preventDefault();
  const videoId = getVideoId(card);
  const token = getHomeToken(card, action);
  if (!videoId || !token) {
    console.warn(`${LOG_PREFIX} no ${action} token for card`, card);
    showToast("Could not find token — refresh and retry.");
    return;
  }

  const placeholder = showRemovedPlaceholder(card, videoId, ACTIONS[action].removedText);
  let undoToken: string | null = null;
  let undoRequested = false;

  placeholder.onUndo = () => {
    undoRequested = true;
    placeholder.restore();
    // If the request is still in flight the undo is sent when it lands.
    if (undoToken) void sendUndo(undoToken);
  };

  try {
    const res = await postFeedback(token);
    undoToken = findLabeledToken(res.actions, UNDO_LABEL);
    if (undoRequested) {
      if (undoToken) void sendUndo(undoToken);
      else showToast("Couldn't undo. YouTube may still have this feedback.");
    } else if (!undoToken) {
      console.warn(`${LOG_PREFIX} no undo token in feedback response`);
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} ${action} failed`, err);
    placeholder.restore();
    if (!undoRequested) showToast("Failed to send feedback to YouTube.");
  }
}

async function sendUndo(token: string): Promise<void> {
  try {
    await postFeedback(token);
  } catch (err) {
    console.warn(`${LOG_PREFIX} undo failed`, err);
    showToast("Couldn't undo. YouTube may still have this feedback.");
  }
}

// ---------------------------------------------------------------------------
// Activation

const HOME_PATH = "/";

export function isOnHome(): boolean {
  return location.pathname === HOME_PATH;
}

let observerStarted = false;

export function activateHomeFeed(): void {
  buildInitialHomeTokenMap();
  const cards = document.querySelectorAll<HTMLElement>(HOME_CARD_SELECTOR);
  console.log(`${LOG_PREFIX} home scan found`, cards.length, "cards");
  cards.forEach(decorateHomeCard);
  if (!observerStarted) {
    observeHomeCards();
    observerStarted = true;
  }
}

export function observeHomeCards(): void {
  const observer = new MutationObserver((mutations) => {
    if (!isOnHome()) return;
    for (const m of mutations) {
      // A card's thumbnail or link may render after the card itself, and a
      // recycled card swaps its children — resync the enclosing card too.
      const enclosing = (m.target as Element).closest?.(HOME_CARD_SELECTOR);
      if (enclosing instanceof HTMLElement) decorateHomeCard(enclosing);
      m.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.matches(HOME_CARD_SELECTOR)) decorateHomeCard(node);
        node.querySelectorAll<HTMLElement>(HOME_CARD_SELECTOR).forEach(decorateHomeCard);
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export { ACTION_LABELS };
