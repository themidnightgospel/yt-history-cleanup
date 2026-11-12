import { LOG_PREFIX } from "./log.js";
import { makeStrokeIcon, makeSvgIcon, showToast } from "./dom-shared.js";
import { player, videoOf, playerFeature } from "./player.js";
import { pickCaption, type Caption } from "./checkin-captions.js";

// `Watch check-in`: now and then the video pauses and a meme asks whether
// you are watching on purpose. First after 1 minute of playback, then every
// 10, and when you come back from a pause of your own that lasted 30 s or
// more. No answer within 12 s, or pressing play, means "keep watching".
// "Zombie. Close it." goes to the home page with a 5 s Undo. Skipped for
// music, live streams and playlists, during the user's quiet hours, and
// while the tab is hidden. A zombie button in the masthead, next to the
// grayscale one, opens the on/off switch and quiet hours. See docs/adr/0009.

export const FIRST_CHECKIN_S = 60;
export const CHECKIN_INTERVAL_S = 600;
export const RESUME_AFTER_PAUSE_MS = 30_000;
/** Matches the 12 s drain animation of `.ythc-checkin-bar` in content.css. */
export const COUNTDOWN_MS = 12_000;
export const UNDO_MS = 5_000;
/** A close older than this (say, the reload never finished) offers no Undo. */
const HANDOFF_MAX_AGE_MS = 30_000;
/** How long after Undo we wait for YouTube's autoplay to pause it. */
const RESUME_WAIT_MS = 8_000;
/**
 * Seeks are caught by the `seeking` event; this only guards against a
 * missed one. Generous, because a background tab may space timeupdates
 * out to a second or more, and at 2× that is several seconds of video.
 */
const MAX_TICK_S = 5;

export const STORAGE_KEY = "ythc-checkin";
/** sessionStorage, per tab: the Undo offered on the home page after a close. */
export const UNDO_KEY = "ythc-checkin-undo";
/** sessionStorage, per tab: Undo asked to come back to this video, paused. */
export const RESUME_KEY = "ythc-checkin-resume";

/** localStorage: the quiet hours, as JSON `{ on, from, to }`. */
export const QUIET_KEY = "ythc-checkin-quiet";

export const OVERLAY_CLASS = "ythc-checkin";
export const CONTROL_CLASS = "ythc-checkin-control";
export const TOGGLE_CLASS = "ythc-checkin-toggle";
export const PANEL_CLASS = "ythc-checkin-panel";
export const KEEP_CLASS = "ythc-checkin-keep";
export const CLOSE_CLASS = "ythc-checkin-close";
export const MUTE_CLASS = "ythc-checkin-mute";
export const COUNTDOWN_CLASS = "ythc-checkin-countdown";

const AD_CLASS = "ad-showing";
const MASTHEAD_END_SELECTOR = "ytd-masthead #end";
const GRAYSCALE_TOGGLE_SELECTOR = ".ythc-grayscale-toggle";
// A zombie shuffling in profile, arms out: the autopilot the check-in
// catches, and the "Zombie. Close it." of the meme. Outlined, stroked paths.
const ZOMBIE_PATHS = [
  // head
  "M10.7 5a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 1 1 4.4 0z",
  // body and legs
  "M8.5 7.4v7.4l-2.3 5.7M8.5 14.8l2.9 5.7",
  // arms, straight out
  "M9.4 9.6h9.1M9.4 12.2h7.6",
];

/** The parts of YouTube's player response we read. */
type PlayerResponse = {
  videoDetails?: { isLive?: boolean; title?: string };
  microformat?: {
    playerMicroformatRenderer?: {
      category?: string;
      liveBroadcastDetails?: { isLiveNow?: boolean };
    };
  };
};
type PlayerApi = HTMLElement & { getPlayerResponse?: () => PlayerResponse | null | undefined };

/** What a close leaves for the home page, to offer Undo. */
type Handoff = { v: string; t: number; title: string; closedAt: number };

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
/** Seconds of this video played in total, for the minute captions. */
let watched = 0;
let due = FIRST_CHECKIN_S;
let lastTime: number | null = null;
/** When the user paused (wall clock), to spot a long pause on resume. */
let pausedAt: number | null = null;
/** A scheduled check-in came due while the tab was hidden. */
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

function video(): HTMLVideoElement | null {
  const p = player();
  return p ? videoOf(p) : null;
}

function adShowing(): boolean {
  return player()?.classList.contains(AD_CLASS) ?? false;
}

function playerResponse(): PlayerResponse | null {
  return player<PlayerApi>()?.getPlayerResponse?.() ?? null;
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
  // Switched back on: start counting from now, not from playback that
  // happened while it was off (which would fire a check-in at once).
  if (on && !enabled) played = 0;
  enabled = on;
  // Switched off mid check-in: let the video carry on.
  if (!on && overlay) answerKeep(true);
  syncControl();
}

// --- exclusions ----------------------------------------------------------------

/** Music, live streams and playlists the user started get no check-ins. */
export function isExcluded(): boolean {
  // A playlist (or mix) the user opened carries `list=`. Autoplay's Up Next
  // does not, so autoplayed videos still get check-ins.
  if (new URLSearchParams(location.search).has("list")) return true;
  const pr = playerResponse();
  const mf = pr?.microformat?.playerMicroformatRenderer;
  // Live right now: pausing would put you behind live. A finished stream's
  // recording is an ordinary video.
  if (pr?.videoDetails?.isLive || mf?.liveBroadcastDetails?.isLiveNow) return true;
  return mf?.category === "Music";
}

// --- clock ---------------------------------------------------------------------

function resetForVideo(id: string | null): void {
  if (id === videoId) return;
  videoId = id;
  played = 0;
  watched = 0;
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
    if (d > 0 && d < MAX_TICK_S) {
      played += d;
      watched += d;
    }
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
  if (!enabled || silenced || overlay || location.pathname !== "/watch") return;
  if (inQuietHours(quiet, new Date()) || adShowing() || isExcluded()) return;
  if (document.hidden) {
    // Nobody to ask. A scheduled check-in waits for the tab to come back;
    // the come-back-from-a-pause one would be stale by then, so it lapses.
    if (!onResume) pending = true;
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

function answerMute(): void {
  silenced = true;
  answerKeep(true);
}

function answerClose(): void {
  const v = video();
  const id = videoId ?? currentVideoId();
  removeOverlay();
  restartInterval();
  if (v) pauseOurselves(v);
  if (id) {
    const handoff: Handoff = {
      v: id,
      t: Math.floor(v?.currentTime ?? 0),
      title: playerResponse()?.videoDetails?.title ?? document.title.replace(/ - YouTube$/, ""),
      closedAt: Date.now(),
    };
    try {
      sessionStorage.setItem(UNDO_KEY, JSON.stringify(handoff));
    } catch {
      // No storage: still close, just without an Undo.
    }
  }
  navigation.assign("/");
}

function textEl(cls: string, s: string): HTMLElement {
  const el = document.createElement("div");
  el.className = cls;
  el.textContent = s;
  return el;
}

function buttonEl(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

/** The meme: caption, character, caption, the answers, and the countdown. */
function buildOverlay(cap: Caption, minutes: number): { root: HTMLElement; countdown: HTMLElement } {
  const root = document.createElement("div");
  root.className = OVERLAY_CLASS;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Are you watching this on purpose?");

  const meme = document.createElement("div");
  meme.className = "ythc-checkin-meme";
  const face = textEl("ythc-checkin-face", cap.face);
  face.setAttribute("aria-hidden", "true");
  const row = document.createElement("div");
  row.className = "ythc-checkin-buttons";
  row.append(
    buttonEl(KEEP_CLASS, "On purpose", () => answerKeep(true)),
    buttonEl(CLOSE_CLASS, "Zombie. Close it.", answerClose),
  );
  const bar = document.createElement("div");
  bar.className = "ythc-checkin-bar";
  bar.appendChild(document.createElement("i"));
  const countdown = textEl(COUNTDOWN_CLASS, `Resuming in ${COUNTDOWN_MS / 1000} s`);
  meme.append(
    textEl("ythc-checkin-text", cap.top({ minutes })),
    face,
    textEl("ythc-checkin-text", cap.bottom({ minutes })),
    row,
    buttonEl(MUTE_CLASS, "Don't ask for this one", answerMute),
    bar,
    countdown,
  );
  root.appendChild(meme);

  // The player toggles playback on clicks, double-clicks and Space; a click
  // or key press on the meme must not reach it.
  root.addEventListener("click", (e) => e.stopPropagation());
  root.addEventListener("dblclick", (e) => e.stopPropagation());
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") e.stopPropagation();
  });
  return { root, countdown };
}

/** No answer means "keep watching": maybe it is playing in your headphones. */
function startCountdown(countdown: HTMLElement): void {
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

function show(onResume: boolean): void {
  const p = player();
  const v = p && videoOf(p);
  if (!p || !v) return;
  const minutes = Math.floor(watched / 60);
  const { root, countdown } = buildOverlay(pickCaption({ minutes }, onResume, usedCaptions), minutes);
  p.appendChild(root);
  overlay = root;
  pauseOurselves(v);
  startCountdown(countdown);
}

// --- quiet hours ---------------------------------------------------------------
//
// Shown to the user as "Relax time": the hours they watch to unwind, when
// no check-in should interrupt.

/** "HH:MM" times; `from` later than `to` wraps past midnight. */
export type QuietHours = { on: boolean; from: string; to: string };
export const DEFAULT_QUIET: QuietHours = { on: false, from: "21:00", to: "06:00" };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

let quiet: QuietHours = { ...DEFAULT_QUIET };

export function readStoredQuiet(): QuietHours {
  try {
    const raw = localStorage.getItem(QUIET_KEY);
    if (raw === null) return { ...DEFAULT_QUIET };
    const q = JSON.parse(raw) as Partial<QuietHours>;
    return {
      on: q.on === true,
      from: typeof q.from === "string" && TIME_RE.test(q.from) ? q.from : DEFAULT_QUIET.from,
      to: typeof q.to === "string" && TIME_RE.test(q.to) ? q.to : DEFAULT_QUIET.to,
    };
  } catch {
    return { ...DEFAULT_QUIET };
  }
}

export function setQuietHours(q: QuietHours): void {
  quiet = q;
  try {
    localStorage.setItem(QUIET_KEY, JSON.stringify(q));
  } catch (err) {
    console.warn(`${LOG_PREFIX} could not persist quiet hours`, err);
  }
  syncControl();
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

/** Whether `at` falls in the quiet hours. Equal from / to means no quiet time. */
export function inQuietHours(q: QuietHours, at: Date): boolean {
  if (!q.on) return false;
  const now = at.getHours() * 60 + at.getMinutes();
  const from = minutesOf(q.from);
  const to = minutesOf(q.to);
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

// --- the masthead control ----------------------------------------------------
//
// A round zombie button next to the grayscale toggle. Clicking it opens
// a panel laid out like YouTube's own account menu: an icon row with the
// on/off switch, and a "Relax time" row that unfolds to two time pickers.

// Material "bedtime" and "chevron_right".
const MOON_PATH_D =
  "M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z";
const CHEVRON_PATH_D = "M9.4 18 8 16.6l4.6-4.6L8 7.4 9.4 6l6 6z";
/** The time pickers offer every half hour. */
const TIME_STEP_MIN = 30;

let mastheadObserver: MutationObserver | null = null;

/** "21:00" in the user's own clock format, e.g. "9:00 PM" or "21:00". */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function hhmm(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function panelPart<T extends HTMLElement>(key: string): T | null {
  return document.querySelector<T>(`.${PANEL_CLASS} [data-ythc='${key}']`);
}

function setSwitch(sw: HTMLElement | null, on: boolean): void {
  sw?.setAttribute("aria-checked", on ? "true" : "false");
}

/** A select of every half hour, plus `current` if a stored time falls between. */
function syncTimeSelect(sel: HTMLSelectElement | null, current: string): void {
  if (!sel) return;
  if (!Array.from(sel.options).some((o) => o.value === current)) {
    const extra = new Option(formatTime(current), current);
    const after = Array.from(sel.options).find((o) => o.value > current);
    sel.add(extra, after ?? null);
  }
  sel.value = current;
  sel.disabled = !quiet.on;
}

function syncControl(): void {
  const btn = document.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`);
  const range = `${formatTime(quiet.from)} – ${formatTime(quiet.to)}`;
  if (btn) {
    btn.setAttribute("aria-pressed", enabled ? "true" : "false");
    const hint = enabled && quiet.on ? `, relax time ${range}` : "";
    btn.title = `Watch check-ins: ${enabled ? "on" : "off"}${hint}`;
  }
  if (!document.querySelector(`.${PANEL_CLASS}`)) return;
  setSwitch(panelPart("enabled"), enabled);
  setSwitch(panelPart("quiet"), quiet.on);
  const summary = panelPart("summary");
  if (summary) summary.textContent = quiet.on ? `No check-ins ${range}` : "Off";
  syncTimeSelect(panelPart<HTMLSelectElement>("from"), quiet.from);
  syncTimeSelect(panelPart<HTMLSelectElement>("to"), quiet.to);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A YouTube-style pill switch. */
function switchEl(key: string, label: string, onToggle: (on: boolean) => void): HTMLButtonElement {
  const sw = el("button", "ythc-switch");
  sw.type = "button";
  sw.dataset["ythc"] = key;
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-checked", "false");
  sw.setAttribute("aria-label", label);
  sw.addEventListener("click", () => onToggle(sw.getAttribute("aria-checked") !== "true"));
  return sw;
}

/** Title over a smaller grey line, the way YouTube's menu rows read. */
function rowText(title: string, sub: HTMLElement | string): HTMLElement {
  const box = el("div", "ythc-menu-text");
  box.append(el("div", undefined, title), typeof sub === "string" ? el("div", "ythc-menu-sub", sub) : sub);
  return box;
}

function timeSelect(key: string, label: string, onChange: (v: string) => void): HTMLLabelElement {
  const wrap = el("label", "ythc-menu-time");
  const sel = el("select");
  sel.dataset["ythc"] = key;
  for (let m = 0; m < 24 * 60; m += TIME_STEP_MIN) sel.add(new Option(formatTime(hhmm(m)), hhmm(m)));
  sel.addEventListener("change", () => {
    if (TIME_RE.test(sel.value)) onChange(sel.value);
  });
  wrap.append(el("span", "ythc-menu-sub", label), sel);
  return wrap;
}

function buildPanel(): HTMLElement {
  const panel = el("div", PANEL_CLASS);
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Watch check-in settings");
  panel.hidden = true;

  // Row 1: the feature itself.
  const main = el("div", "ythc-menu-row");
  main.append(
    makeStrokeIcon(ZOMBIE_PATHS, 24),
    rowText("Watch check-ins", "Asks if you're watching on purpose"),
    switchEl("enabled", "Watch check-ins", setCheckinEnabled),
  );

  // Row 2: quiet hours, folded until clicked.
  const summary = el("div", "ythc-menu-sub");
  summary.dataset["ythc"] = "summary";
  const quietRow = el("button", "ythc-menu-row ythc-menu-click");
  quietRow.type = "button";
  quietRow.dataset["ythc"] = "expand";
  quietRow.setAttribute("aria-expanded", "false");
  const chevron = makeSvgIcon(CHEVRON_PATH_D, 20);
  chevron.classList.add("ythc-menu-chevron");
  quietRow.append(makeSvgIcon(MOON_PATH_D, 24), rowText("Relax time", summary), chevron);

  const times = el("div", "ythc-menu-times");
  times.hidden = true;
  const head = el("div", "ythc-menu-times-head");
  head.append(
    el("span", "ythc-menu-sub", "Let me watch freely at these times"),
    switchEl("quiet", "Relax time", (on) => setQuietHours({ ...quiet, on })),
  );
  times.append(
    head,
    timeSelect("from", "From", (from) => setQuietHours({ ...quiet, from })),
    timeSelect("to", "To", (to) => setQuietHours({ ...quiet, to })),
  );
  quietRow.addEventListener("click", () => {
    times.hidden = !times.hidden;
    quietRow.setAttribute("aria-expanded", times.hidden ? "false" : "true");
  });

  panel.append(main, el("div", "ythc-menu-divider"), quietRow, times);
  // Keys pressed here are not YouTube shortcuts, and clicks here do not
  // count as clicking outside.
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel(true);
    e.stopPropagation();
  });
  panel.addEventListener("click", (e) => e.stopPropagation());
  return panel;
}

function closePanel(refocus = false): void {
  const panel = document.querySelector<HTMLElement>(`.${PANEL_CLASS}`);
  const btn = document.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`);
  if (panel) panel.hidden = true;
  btn?.setAttribute("aria-expanded", "false");
  if (refocus) btn?.focus();
}

function togglePanel(): void {
  const panel = document.querySelector<HTMLElement>(`.${PANEL_CLASS}`);
  const btn = document.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`);
  if (!panel || !btn) return;
  if (!panel.hidden) {
    closePanel();
    return;
  }
  syncControl();
  panel.hidden = false;
  btn.setAttribute("aria-expanded", "true");
}

let outsideClickInstalled = false;

/** Idempotent: one control, right after the grayscale toggle when it is there. */
export function ensureCheckinToggle(): void {
  if (document.querySelector(`.${TOGGLE_CLASS}`)) {
    syncControl();
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

  const wrap = document.createElement("div");
  wrap.className = CONTROL_CLASS;
  const btn = document.createElement("button");
  btn.type = "button";
  // Shares the grayscale toggle's look (content.css).
  btn.className = TOGGLE_CLASS;
  btn.setAttribute("aria-label", "Watch check-ins");
  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-expanded", "false");
  btn.appendChild(makeStrokeIcon(ZOMBIE_PATHS, 24));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    togglePanel();
  });
  wrap.append(btn, buildPanel());
  const gray = end.querySelector<HTMLElement>(GRAYSCALE_TOGGLE_SELECTOR);
  end.insertBefore(wrap, gray ? gray.nextSibling : end.firstChild);
  if (!outsideClickInstalled) {
    outsideClickInstalled = true;
    document.addEventListener("click", () => closePanel());
  }
  syncControl();
}

// --- undo across the reload ----------------------------------------------------

/** Reads and removes a sessionStorage entry: each handoff is used once. */
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

/** On the home page right after a close: offer Undo for 5 s. */
function offerUndo(): void {
  const h = takeSession<Handoff>(UNDO_KEY);
  if (!h || typeof h.v !== "string" || typeof h.closedAt !== "number") return;
  if (Date.now() - h.closedAt > HANDOFF_MAX_AGE_MS) return;
  // The 5 s start now, when the toast can be seen, not at the click that
  // began the reload.
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
    UNDO_MS,
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
function ensureCheckinPlayer(): boolean {
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
    quiet = readStoredQuiet();
    document.addEventListener("visibilitychange", onVisibility);
    // Another youtube.com tab changed a setting: follow it.
    window.addEventListener("storage", (e) => {
      if (e.key === STORAGE_KEY || e.key === null) applyEnabled(readStoredEnabled());
      if (e.key === QUIET_KEY || e.key === null) {
        quiet = readStoredQuiet();
        syncControl();
      }
    });
  }
  ensureCheckinToggle();
  resetForVideo(page === "watch" ? currentVideoId() : null);
  if (page === "home") offerUndo();
  if (page === "watch") honourResume();
  ensureOnWatch(page === "watch");
}
