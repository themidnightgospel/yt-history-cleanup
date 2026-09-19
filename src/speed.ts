import { LOG_PREFIX } from "./log.js";

// Playback `speed buttons`: 1.25 / 1.5 / 1.75 / 2 in the player's bottom
// bar, grouped just before the captions and settings buttons, so changing
// speed no longer means opening the gear menu. See docs/adr/0007.

export const SPEEDS: readonly number[] = [1.25, 1.5, 1.75, 2];
export const NORMAL_SPEED = 1;
export const GROUP_CLASS = "ythc-speed-group";
export const BUTTON_CLASS = "ythc-speed-btn";
export const ACTIVE_CLASS = "ythc-speed-active";

const PLAYER_SELECTOR = "#movie_player";
const RIGHT_CONTROLS_SELECTOR = ".ytp-right-controls";
// The group goes in front of the first of these that exists.
const ANCHOR_SELECTOR = ".ytp-subtitles-button, .ytp-settings-button";
const VIDEO_SELECTOR = "video.html5-main-video, video";

type PlayerApi = HTMLElement & {
  setPlaybackRate?: (rate: number) => void;
  getPlaybackRate?: () => number;
};

function player(): PlayerApi | null {
  return document.querySelector<PlayerApi>(PLAYER_SELECTOR);
}

function videoOf(p: HTMLElement): HTMLVideoElement | null {
  return p.querySelector<HTMLVideoElement>(VIDEO_SELECTOR);
}

export function currentRate(): number {
  const p = player();
  if (!p) return NORMAL_SPEED;
  if (typeof p.getPlaybackRate === "function") {
    const r = p.getPlaybackRate();
    if (typeof r === "number" && r > 0) return r;
  }
  return videoOf(p)?.playbackRate ?? NORMAL_SPEED;
}

// Prefer the player's own API so YouTube's state (gear menu, per-session
// memory) stays in agreement; fall back to the media element.
export function setRate(rate: number): void {
  const p = player();
  if (!p) return;
  if (typeof p.setPlaybackRate === "function") {
    p.setPlaybackRate(rate);
  } else {
    const v = videoOf(p);
    if (v) v.playbackRate = rate;
    else console.warn(`${LOG_PREFIX} no player API and no video element`);
  }
  syncActive();
}

export function syncActive(): void {
  const group = document.querySelector<HTMLElement>(`.${GROUP_CLASS}`);
  if (!group) return;
  const rate = currentRate();
  for (const btn of group.querySelectorAll<HTMLButtonElement>(`.${BUTTON_CLASS}`)) {
    const on = Number(btn.dataset["speed"]) === rate;
    btn.classList.toggle(ACTIVE_CLASS, on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

function makeButton(speed: number): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  // `ytp-button` gives YouTube's own sizing, hover and focus styling.
  btn.className = `ytp-button ${BUTTON_CLASS}`;
  btn.dataset["speed"] = String(speed);
  btn.textContent = `${speed}×`;
  btn.title = `Playback speed ${speed}×`;
  btn.setAttribute("aria-label", `Playback speed ${speed}×`);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    // Clicking the active speed returns to normal speed.
    setRate(currentRate() === speed ? NORMAL_SPEED : speed);
  });
  return btn;
}

const listenedVideos = new WeakSet<HTMLVideoElement>();

/** Idempotent: inserts the group once and keeps it in sync with the rate. */
export function ensureSpeedButtons(): boolean {
  const p = player();
  if (!p) return false;
  const controls = p.querySelector<HTMLElement>(RIGHT_CONTROLS_SELECTOR);
  if (!controls) return false;

  let group = controls.querySelector<HTMLElement>(`.${GROUP_CLASS}`);
  if (!group) {
    group = document.createElement("div");
    group.className = GROUP_CLASS;
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Playback speed");
    for (const s of SPEEDS) group.appendChild(makeButton(s));
    const anchor = controls.querySelector<HTMLElement>(ANCHOR_SELECTOR);
    if (anchor?.parentElement) anchor.parentElement.insertBefore(group, anchor);
    else controls.insertBefore(group, controls.firstChild);
  }

  // The gear menu and keyboard shortcuts change the rate behind our back.
  const v = videoOf(p);
  if (v && !listenedVideos.has(v)) {
    listenedVideos.add(v);
    v.addEventListener("ratechange", syncActive);
  }
  syncActive();
  return true;
}

let waiting: MutationObserver | null = null;

/**
 * Called on every route. On the watch page the player and its controls may
 * stamp after us, so wait for them once; elsewhere stop waiting.
 */
export function initSpeedButtons(onWatch: boolean): void {
  if (!onWatch) {
    waiting?.disconnect();
    waiting = null;
    return;
  }
  if (ensureSpeedButtons()) {
    waiting?.disconnect();
    waiting = null;
    return;
  }
  if (waiting || !document.body) return;
  waiting = new MutationObserver(() => {
    if (ensureSpeedButtons()) {
      waiting?.disconnect();
      waiting = null;
    }
  });
  waiting.observe(document.body, { childList: true, subtree: true });
}
