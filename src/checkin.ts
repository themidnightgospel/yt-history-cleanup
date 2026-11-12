import { LOG_PREFIX } from "./log.js";
import { makeSvgIcon, showToast } from "./dom-shared.js";
import { player, videoOf, playerFeature } from "./player.js";
import { pickCaption, type Caption } from "./checkin-captions.js";

// `Watch check-in`: now and then the video pauses and a meme asks whether
// you are watching on purpose. First after 1 minute of playback, then every
// 10, and when you come back from a pause of your own that lasted 30 s or
// more. No answer within 5 s, or pressing play, means "keep watching".
// "Zombie. Close it." goes to the home page with a 5 s Undo. Skipped for
// music, live streams and playlists, and while the tab is hidden. An on/off
// toggle sits in the masthead next to the grayscale one. See docs/adr/0009.

export const FIRST_CHECKIN_S = 60;
export const CHECKIN_INTERVAL_S = 600;
export const RESUME_AFTER_PAUSE_MS = 30_000;
export const COUNTDOWN_MS = 5_000;
export const UNDO_MS = 5_000;
/** How long after Undo we wait for YouTube's autoplay to pause it. */
const RESUME_WAIT_MS = 8_000;
/** Larger jumps between two timeupdates are seeks, not playback. */
const MAX_TICK_S = 2;

export const STORAGE_KEY = "ythc-checkin";
/** sessionStorage, per tab: the Undo offered on the home page after a close. */
export const UNDO_KEY = "ythc-checkin-undo";
/** sessionStorage, per tab: Undo asked to come back to this video, paused. */
export const RESUME_KEY = "ythc-checkin-resume";

export const OVERLAY_CLASS = "ythc-checkin";
export const TOGGLE_CLASS = "ythc-checkin-toggle";
export const KEEP_CLASS = "ythc-checkin-keep";
export const CLOSE_CLASS = "ythc-checkin-close";
export const MUTE_CLASS = "ythc-checkin-mute";
export const COUNTDOWN_CLASS = "ythc-checkin-countdown";

const AD_CLASS = "ad-showing";
const MASTHEAD_END_SELECTOR = "ytd-masthead #end";
const GRAYSCALE_TOGGLE_SELECTOR = ".ythc-grayscale-toggle";
// Material "hourglass_empty".
const HOURGLASS_PATH_D =
  "M6 2v6h.01L6 8.01 10 12l-4 4 .01.01H6V22h12v-5.99h-.01L18 16l-4-4 4-3.99-.01-.01H18V2H6zm10 14.5V20H8v-3.5l4-4 4 4zm-4-5-4-4V4h8v3.5l-4 4z";

type PlayerResponse = {
  videoDetails?: { isLive?: boolean; title?: string };
  microformat?: { playerMicroformatRenderer?: { category?: string; isLiveBroadcast?: boolean } };
};
type PlayerApi = HTMLElement & { getPlayerResponse?: () => PlayerResponse | null | undefined };

type Handoff = { v: string; t: number; title: string; until: number };

/** Page navigation, replaceable in tests (jsdom cannot navigate). */
export const navigation = {
  assign(url: string): void {
    location.assign(url);
  },
};

// --- state -----------------------------------------------------------------

let enabled = true;
let videoId: string | null = null;
/** Seconds of this video played since the last check-in (video time). */
let played = 0;
let due = FIRST_CHECKIN_S;
let lastTime: number | null = null;
/** When the user paused (wall clock), to spot a long pause on resume. */
let pausedAt: number | null = null;
/** A check-in came due while the tab was hidden. */
let pending = false;
/** "Don't ask for this one": no more check-ins until the video changes. */
let silenced = false;
/** Pause the next playback once: Undo brought us back here. */
let resumePaused = false;
/** The next pause / play event is our own doing. */
let ourPause = false;
let ourPlay = false;
let overlay: HTMLElement | null = null;
let timers: number[] = [];
const usedCaptions = new Set<Caption>();

function currentVideoId(): string | null {
  return new URLSearchParams(location.search).get("v");
}

function onWatchPage(): boolean {
  return location.pathname === "/watch";
}

function video(): HTMLVideoElement | null {
  const p = player();
  return p ? videoOf(p) : null;
}

function adShowing(): boolean {
  return player()?.classList.contains(AD_CLASS) ?? false;
}

export function isCheckinOverlayShown(): boolean {
  return overlay !== null;
}

// --- preference --------------------------------------------------------------

export function readStoredEnabled(): boolean {
  try {
    // Absent key means never toggled: default on.
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function isCheckinEnabled(): boolean {
  return enabled;
}

export function setCheckinEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch (err) {
    console.warn(`${LOG_PREFIX} could not persist check-in setting`, err);
  }
  applyEnabled(on);
}

function applyEnabled(on: boolean): void {
  enabled = on;
  // Turning it off mid check-in lets the video carry on.
  if (!on && overlay) answerKeep(true);
  syncToggle();
}

// --- exclusions ----------------------------------------------------------------

/** Music, live streams and playlists the user started get no check-ins. */
export function isExcluded(): boolean {
  // A playlist (or mix) the user opened carries `list=`. Autoplay's Up Next
  // does not, so autoplayed videos still get check-ins.
  if (new URLSearchParams(location.search).has("list")) return true;
  const pr = player<PlayerApi>()?.getPlayerResponse?.() ?? null;
  if (pr?.videoDetails?.isLive) return true;
  const mf = pr?.microformat?.playerMicroformatRenderer;
  if (mf?.isLiveBroadcast) return true;
  return mf?.category === "Music";
}

// --- clock ---------------------------------------------------------------------

function resetForVideo(id: string | null): void {
  if (id === videoId) return;
  videoId = id;
  played = 0;
  due = FIRST_CHECKIN_S;
  lastTime = null;
  pausedAt = null;
  pending = false;
  resumePaused = false;
  silenced = false;
  if (overlay) removeOverlay();
}

/** After any "keep watching", the next check-in is a full interval away. */
function restartInterval(): void {
  played = 0;
  due = CHECKIN_INTERVAL_S;
  pausedAt = null;
  pending = false;
}

function onTimeUpdate(this: HTMLVideoElement): void {
  const t = this.currentTime;
  if (lastTime !== null && !this.paused && !adShowing()) {
    const d = t - lastTime;
    if (d > 0 && d < MAX_TICK_S) played += d;
  }
  lastTime = t;
  if (played >= due) maybeShow(false);
}

function onSeeking(): void {
  lastTime = null;
}

function onPause(this: HTMLVideoElement): void {
  if (ourPause) {
    ourPause = false;
    return;
  }
  if (this.ended || adShowing() || overlay) return;
  pausedAt = Date.now();
}

function onPlay(this: HTMLVideoElement): void {
  if (ourPlay) {
    ourPlay = false;
    return;
  }
  if (resumePaused && currentVideoId() === videoId) {
    // Back from Undo: land paused, so playing on is a conscious choice.
    resumePaused = false;
    pauseOurselves(this);
    return;
  }
  if (overlay) {
    // Pressing play instead of answering counts as "keep watching".
    answerKeep(false);
    return;
  }
  const since = pausedAt;
  pausedAt = null;
  if (since !== null && Date.now() - since >= RESUME_AFTER_PAUSE_MS) maybeShow(true);
}

function onVisibility(): void {
  if (document.hidden || !pending) return;
  const v = video();
  if (v && !v.paused) maybeShow(false);
}

function pauseOurselves(v: HTMLVideoElement): void {
  if (v.paused) return;
  ourPause = true;
  v.pause();
}

function playOurselves(v: HTMLVideoElement): void {
  if (!v.paused) return;
  ourPlay = true;
  try {
    const p = v.play() as Promise<void> | undefined;
    p?.catch?.(() => {
      ourPlay = false;
    });
  } catch {
    ourPlay = false;
  }
}

// --- the check-in --------------------------------------------------------------

function maybeShow(onResume: boolean): void {
  if (!enabled || silenced || overlay || !onWatchPage() || adShowing() || isExcluded()) return;
  if (document.hidden) {
    pending = true;
    return;
  }
  pending = false;
  show(onResume);
}

function clearTimers(): void {
  for (const t of timers) clearTimeout(t);
  timers = [];
}

function removeOverlay(): void {
  clearTimers();
  overlay?.remove();
  overlay = null;
}

function answerKeep(resume: boolean): void {
  removeOverlay();
  restartInterval();
  const v = video();
  if (resume && v) playOurselves(v);
}

function answerClose(): void {
  const v = video();
  const id = videoId ?? currentVideoId();
  removeOverlay();
  restartInterval();
  if (v) pauseOurselves(v);
  if (id) {
    const pr = player<PlayerApi>()?.getPlayerResponse?.() ?? null;
    const handoff: Handoff = {
      v: id,
      t: Math.floor(v?.currentTime ?? 0),
      title: pr?.videoDetails?.title ?? document.title.replace(/ - YouTube$/, ""),
      until: Date.now() + UNDO_MS,
    };
    try {
      sessionStorage.setItem(UNDO_KEY, JSON.stringify(handoff));
    } catch {
      // No storage: still close, just without an Undo.
    }
  }
  navigation.assign("/");
}

function memeText(cls: string, s: string): HTMLElement {
  const el = document.createElement("div");
  el.className = cls;
  el.textContent = s;
  return el;
}

function show(onResume: boolean): void {
  const p = player();
  const v = p && videoOf(p);
  if (!p || !v) return;
  const minutes = Math.floor((v.currentTime || 0) / 60);
  const cap = pickCaption({ minutes }, onResume, usedCaptions);

  const root = document.createElement("div");
  root.className = OVERLAY_CLASS;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Are you watching this on purpose?");
  const meme = document.createElement("div");
  meme.className = "ythc-checkin-meme";
  meme.appendChild(memeText("ythc-checkin-text", cap.top({ minutes })));
  const face = memeText("ythc-checkin-face", cap.face);
  face.setAttribute("aria-hidden", "true");
  meme.appendChild(face);
  meme.appendChild(memeText("ythc-checkin-text", cap.bottom({ minutes })));

  const row = document.createElement("div");
  row.className = "ythc-checkin-buttons";
  const keep = document.createElement("button");
  keep.type = "button";
  keep.className = KEEP_CLASS;
  keep.textContent = "On purpose";
  keep.addEventListener("click", () => answerKeep(true));
  const close = document.createElement("button");
  close.type = "button";
  close.className = CLOSE_CLASS;
  close.textContent = "Zombie. Close it.";
  close.addEventListener("click", answerClose);
  row.append(keep, close);
  meme.appendChild(row);
  const mute = document.createElement("button");
  mute.type = "button";
  mute.className = MUTE_CLASS;
  mute.textContent = "Don't ask for this one";
  mute.addEventListener("click", () => {
    silenced = true;
    answerKeep(true);
  });
  meme.appendChild(mute);

  const bar = document.createElement("div");
  bar.className = "ythc-checkin-bar";
  bar.appendChild(document.createElement("i"));
  meme.appendChild(bar);
  const countdown = memeText(COUNTDOWN_CLASS, `Resuming in ${COUNTDOWN_MS / 1000} s`);
  meme.appendChild(countdown);
  root.appendChild(meme);

  // The player toggles playback on clicks and keys; ours stay ours.
  root.addEventListener("click", (e) => e.stopPropagation());
  root.addEventListener("dblclick", (e) => e.stopPropagation());
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") e.stopPropagation();
  });

  p.appendChild(root);
  overlay = root;
  pauseOurselves(v);

  // No answer means "keep watching": maybe it is playing in your headphones.
  let left = COUNTDOWN_MS / 1000;
  const tick = (): void => {
    left -= 1;
    if (!overlay) return;
    if (left <= 0) {
      answerKeep(true);
      return;
    }
    countdown.textContent = `Resuming in ${left} s`;
    timers.push(window.setTimeout(tick, 1000));
  };
  timers.push(window.setTimeout(tick, 1000));
}

// --- the masthead toggle ---------------------------------------------------------

let mastheadObserver: MutationObserver | null = null;

function syncToggle(): void {
  const btn = document.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`);
  if (!btn) return;
  btn.setAttribute("aria-pressed", enabled ? "true" : "false");
  btn.title = `Watch check-ins: ${enabled ? "on" : "off"}`;
}

/** Idempotent: one toggle, right after the grayscale toggle when it is there. */
export function ensureCheckinToggle(): void {
  if (document.querySelector(`.${TOGGLE_CLASS}`)) {
    syncToggle();
    return;
  }
  const end = document.querySelector<HTMLElement>(MASTHEAD_END_SELECTOR);
  if (!end) {
    if (mastheadObserver || !document.body) return;
    mastheadObserver = new MutationObserver(() => {
      if (document.querySelector(MASTHEAD_END_SELECTOR)) ensureCheckinToggle();
    });
    mastheadObserver.observe(document.body, { childList: true, subtree: true });
    return;
  }
  mastheadObserver?.disconnect();
  mastheadObserver = null;

  const btn = document.createElement("button");
  btn.type = "button";
  // Shares the grayscale toggle's look (content.css).
  btn.className = TOGGLE_CLASS;
  btn.setAttribute("aria-label", "Watch check-ins");
  btn.appendChild(makeSvgIcon(HOURGLASS_PATH_D, 24));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    setCheckinEnabled(!enabled);
  });
  const gray = end.querySelector<HTMLElement>(GRAYSCALE_TOGGLE_SELECTOR);
  end.insertBefore(btn, gray ? gray.nextSibling : end.firstChild);
  syncToggle();
}

// --- undo across the reload ----------------------------------------------------

function takeSession<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return null;
    sessionStorage.removeItem(key);
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** On the home page right after a close: offer Undo for what is left of 5 s. */
function offerUndo(): void {
  const h = takeSession<Handoff>(UNDO_KEY);
  if (!h || typeof h.v !== "string") return;
  const left = h.until - Date.now();
  if (left <= 0) return;
  showToast(
    `Closed: ${h.title}`,
    {
      label: "Undo",
      onClick: () => {
        try {
          sessionStorage.setItem(RESUME_KEY, JSON.stringify({ v: h.v }));
        } catch {
          // Without storage the video comes back playing; still useful.
        }
        navigation.assign(`/watch?v=${encodeURIComponent(h.v)}&t=${Math.max(0, Math.floor(h.t))}s`);
      },
    },
    left,
  );
}

/** On the watch page right after Undo: land paused, and count it as "keep watching". */
function honourResume(): void {
  const r = takeSession<{ v: string }>(RESUME_KEY);
  if (!r || r.v !== currentVideoId()) return;
  restartInterval();
  const v = video();
  if (v && !v.paused) {
    pauseOurselves(v);
    return;
  }
  // Wait for YouTube's autoplay, but not forever: if it never comes, the
  // user's own first play must not be undone.
  resumePaused = true;
  window.setTimeout(() => {
    resumePaused = false;
  }, RESUME_WAIT_MS);
}

// --- wiring --------------------------------------------------------------------

const watchedVideos = new WeakSet<HTMLVideoElement>();

function onLoadStart(): void {
  // YouTube loads the next video into the same element, sometimes playing
  // it before the route event; the URL already has the new `v=`.
  const id = currentVideoId();
  if (id !== null) resetForVideo(id);
}

/** Idempotent: attaches the playback listeners to the current video element. */
export function ensureCheckinPlayer(): boolean {
  const v = video();
  if (!v) return false;
  if (!watchedVideos.has(v)) {
    watchedVideos.add(v);
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("seeking", onSeeking);
    v.addEventListener("pause", onPause);
    v.addEventListener("play", onPlay);
    v.addEventListener("loadstart", onLoadStart);
  }
  return true;
}

const ensureOnWatch = playerFeature(ensureCheckinPlayer);
let globalsInstalled = false;

/** Called on every route. */
export function initCheckin(page: "home" | "watch" | null): void {
  if (!globalsInstalled) {
    globalsInstalled = true;
    enabled = readStoredEnabled();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("storage", (e) => {
      if (e.key === STORAGE_KEY || e.key === null) applyEnabled(readStoredEnabled());
    });
  }
  ensureCheckinToggle();
  resetForVideo(page === "watch" ? currentVideoId() : null);
  if (page === "home") offerUndo();
  if (page === "watch") honourResume();
  ensureOnWatch(page === "watch");
}
