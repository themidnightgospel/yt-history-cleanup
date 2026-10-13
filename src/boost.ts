import { LOG_PREFIX } from "./log.js";
import { makeSvgIcon } from "./dom-shared.js";
import { player, videoOf, rightControls, insertGroup, playerFeature } from "./player.js";
import { GROUP_CLASS as SPEED_GROUP_CLASS } from "./speed.js";

// `Volume boost`: one speaker-plus button in the player's bottom bar, left
// of the speed buttons. Hovering (or keyboard-focusing) it opens a row of
// 1.5× / 2× / 3× chips above the bar. The boost multiplies the native volume
// through a Web Audio gain node followed by a limiter, attached lazily on the
// first boost. It resets on every new video and is lifted while an ad plays.
// See docs/adr/0008.

export const BOOSTS: readonly number[] = [1.5, 2, 3];
export const NO_BOOST = 1;
export const DEFAULT_BOOST = 2;
export const GROUP_CLASS = "ythc-boost";
export const BUTTON_CLASS = "ythc-boost-btn";
export const MULT_CLASS = "ythc-boost-mult";
export const MENU_CLASS = "ythc-boost-menu";
export const CHIP_CLASS = "ythc-boost-chip";
export const ACTIVE_CLASS = "ythc-boost-active";
/** On `#movie_player`: the chosen multiplier while boosted, absent at 1×. */
export const BOOST_ATTR = "data-ythc-boost";

// YouTube puts this on #movie_player for the whole of an ad break.
const AD_CLASS = "ad-showing";

// Limiter settings: squash peaks that the boost pushes past full scale
// instead of letting them clip. The threshold must stay at 0 dBFS: a
// DynamicsCompressorNode adds makeup gain derived from threshold and ratio
// (about +3.4 dB at -6 dBFS / 20:1), which would make 1× louder than native.
const LIMITER = { threshold: 0, knee: 0, ratio: 20, attack: 0.003, release: 0.25 };
/** Time constant of the glide between gains, in seconds. */
const GAIN_GLIDE_S = 0.015;

// A speaker with sound waves, and a "+" at the top right.
const ICON_PATHS = [
  "M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z" +
    "M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z",
  "M19 1v2h2v1h-2v2h-1V4h-2V3h2V1z",
];

// --- state -----------------------------------------------------------------

/** The chosen multiplier. Not persisted: resets per video (ADR 0008). */
let boost = NO_BOOST;
/** What the icon button turns back on to. */
let lastBoost = DEFAULT_BOOST;
/** The `v=` the current boost belongs to. */
let videoId: string | null = null;

type Graph = { ctx: AudioContext; gain: GainNode; video: HTMLVideoElement };
let graph: Graph | null = null;
/** Elements that could not be captured (typically: another extension has them). */
const uncapturable = new WeakSet<HTMLVideoElement>();

function currentVideoId(): string | null {
  return new URLSearchParams(location.search).get("v");
}

export function currentBoost(): number {
  return boost;
}

// --- audio graph -----------------------------------------------------------

/**
 * Routes the video element through gain → limiter → speakers. A media
 * element can be captured only once and never released, so the graph is
 * built lazily (on the first boost, from a click, which satisfies the
 * autoplay policy) and kept for the life of the element; 1× then just
 * means gain 1.
 */
function ensureGraph(video: HTMLVideoElement): Graph | null {
  if (graph?.video === video) return graph;
  if (typeof AudioContext !== "function" || uncapturable.has(video)) return null;
  // A different element: YouTube swapped it. The old graph is useless now.
  if (graph) {
    void graph.ctx.close().catch(() => {});
    graph = null;
  }
  let ctx: AudioContext | undefined;
  try {
    ctx = new AudioContext();
    const source = ctx.createMediaElementSource(video);
    const gain = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = LIMITER.threshold;
    limiter.knee.value = LIMITER.knee;
    limiter.ratio.value = LIMITER.ratio;
    limiter.attack.value = LIMITER.attack;
    limiter.release.value = LIMITER.release;
    source.connect(gain);
    gain.connect(limiter);
    limiter.connect(ctx.destination);
    graph = { ctx, gain, video };
    return graph;
  } catch (err) {
    // Typically: another extension already captured the element. Free the
    // context and leave this element alone from now on.
    uncapturable.add(video);
    void ctx?.close().catch(() => {});
    console.warn(`${LOG_PREFIX} could not attach the volume boost`, err);
    return null;
  }
}

function adShowing(): boolean {
  return player()?.classList.contains(AD_CLASS) ?? false;
}

/** The gain actually applied right now: the chosen boost, or 1× during an ad. */
export function effectiveGain(): number {
  return adShowing() ? NO_BOOST : boost;
}

function applyGain(): void {
  const p = player();
  const v = p && videoOf(p);
  if (!v) return;
  // Capture an element only when there is a boost to apply: resetting to 1×
  // on a new or swapped element must leave that element untouched.
  if (boost === NO_BOOST && graph?.video !== v) return;
  const g = ensureGraph(v);
  if (!g) return;
  // Glide instead of stepping: an instant gain change clicks audibly.
  const now = g.ctx.currentTime;
  g.gain.gain.cancelScheduledValues(now);
  g.gain.gain.setTargetAtTime(effectiveGain(), now, GAIN_GLIDE_S);
  if (g.ctx.state === "suspended") void g.ctx.resume().catch(() => {});
}

// --- state changes ---------------------------------------------------------

export function setBoost(value: number): void {
  boost = value;
  if (value !== NO_BOOST) lastBoost = value;
  applyGain();
  syncUi();
}

function toggleBoost(): void {
  setBoost(boost === NO_BOOST ? lastBoost : NO_BOOST);
}

export function syncUi(): void {
  const p = player();
  if (!p) return;
  if (boost === NO_BOOST) p.removeAttribute(BOOST_ATTR);
  else p.setAttribute(BOOST_ATTR, String(boost));

  const group = p.querySelector<HTMLElement>(`.${GROUP_CLASS}`);
  if (!group) return;
  const on = boost !== NO_BOOST;
  const btn = group.querySelector<HTMLButtonElement>(`.${BUTTON_CLASS}`);
  if (btn) {
    btn.classList.toggle(ACTIVE_CLASS, on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    const label = on ? `Volume boost ${boost}×, click to turn off` : "Volume boost";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    const mult = btn.querySelector<HTMLElement>(`.${MULT_CLASS}`);
    if (mult) mult.textContent = on ? `${boost}×` : "";
  }
  for (const chip of group.querySelectorAll<HTMLButtonElement>(`.${CHIP_CLASS}`)) {
    const active = Number(chip.dataset["boost"]) === boost;
    chip.classList.toggle(ACTIVE_CLASS, active);
    chip.setAttribute("aria-checked", active ? "true" : "false");
  }
}

// --- DOM -------------------------------------------------------------------

function makeChip(value: number): HTMLButtonElement {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = CHIP_CLASS;
  chip.dataset["boost"] = String(value);
  chip.textContent = `${value}×`;
  chip.setAttribute("role", "menuitemradio");
  chip.setAttribute("aria-label", `Volume boost ${value}×`);
  // Clicking the active chip turns the boost off, as with speed.
  chip.addEventListener("click", () => setBoost(boost === value ? NO_BOOST : value));
  return chip;
}

function makeGroup(): HTMLElement {
  const group = document.createElement("div");
  group.className = GROUP_CLASS;
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Volume boost");

  const btn = document.createElement("button");
  btn.type = "button";
  // `ytp-button` gives YouTube's own sizing, hover and focus styling.
  btn.className = `ytp-button ${BUTTON_CLASS}`;
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");
  btn.appendChild(makeSvgIcon(ICON_PATHS));
  const mult = document.createElement("span");
  mult.className = MULT_CLASS;
  btn.appendChild(mult);
  btn.addEventListener("click", toggleBoost);

  const menu = document.createElement("div");
  menu.className = MENU_CLASS;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Volume boost level");
  for (const b of BOOSTS) menu.appendChild(makeChip(b));

  // The row opens on hover / focus via CSS; aria-expanded mirrors that.
  const expanded = (v: boolean): void => btn.setAttribute("aria-expanded", v ? "true" : "false");
  group.addEventListener("pointerenter", () => expanded(true));
  group.addEventListener("pointerleave", () => expanded(group.matches(":focus-within")));
  group.addEventListener("focusin", () => expanded(true));
  group.addEventListener("focusout", (e) => {
    if (!group.contains(e.relatedTarget as Node | null)) expanded(group.matches(":hover"));
  });
  group.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      (document.activeElement as HTMLElement | null)?.blur();
      e.stopPropagation();
    }
  });
  group.addEventListener("click", (e) => {
    // A click must not reach the player, which toggles playback on it.
    e.stopPropagation();
    // Chrome leaves focus on a mouse-clicked button, and the focus-opened
    // row would then stay open after the pointer leaves. Keyboard presses
    // (detail 0) keep focus so Tab / Enter / Escape still work.
    const focused = document.activeElement;
    if (e.detail > 0 && focused instanceof HTMLElement && group.contains(focused)) focused.blur();
  });

  group.appendChild(btn);
  group.appendChild(menu);
  return group;
}

/** A new video gets no boost: the previous one was quiet, this one may not be. */
function resetForVideo(id: string | null): void {
  if (id === videoId) return;
  videoId = id;
  if (boost !== NO_BOOST) setBoost(NO_BOOST);
}

/**
 * YouTube loads the next video into the same element, and it can start
 * playing before the route event lands. The URL already carries the new
 * `v=` by then, so reset here. Off the watch page there is no `v=`, and the
 * route handles it.
 */
function onLoadStart(): void {
  const id = currentVideoId();
  if (id !== null) resetForVideo(id);
}

const watchedPlayers = new WeakSet<HTMLElement>();
const watchedVideos = new WeakSet<HTMLVideoElement>();

/** Idempotent: inserts the group once and keeps it in sync. */
export function ensureBoostButton(): boolean {
  const p = player();
  if (!p) return false;
  const controls = rightControls(p);
  if (!controls) return false;

  if (!controls.querySelector(`.${GROUP_CLASS}`)) {
    // Left of the speed group when it is already there; otherwise in front
    // of the captions / settings anchor, where the speed group will then
    // insert itself after us.
    insertGroup(controls, makeGroup(), controls.querySelector<HTMLElement>(`.${SPEED_GROUP_CLASS}`));
  }

  // Ad breaks toggle `ad-showing` on the player; lift the boost for their
  // duration. YouTube rewrites that class list many times a second
  // (autohide, play state), so act only when `ad-showing` itself flips.
  if (!watchedPlayers.has(p)) {
    watchedPlayers.add(p);
    let ad = p.classList.contains(AD_CLASS);
    new MutationObserver(() => {
      if (p.classList.contains(AD_CLASS) === ad) return;
      ad = !ad;
      applyGain();
    }).observe(p, { attributes: true, attributeFilter: ["class"] });
  }
  const v = videoOf(p);
  if (v && !watchedVideos.has(v)) {
    watchedVideos.add(v);
    v.addEventListener("loadstart", onLoadStart);
  }
  syncUi();
  return true;
}

const ensureOnWatch = playerFeature(ensureBoostButton);

/** Called on every route: resets the boost for a new video or off the watch page. */
export function initBoostButton(onWatch: boolean): void {
  resetForVideo(onWatch ? currentVideoId() : null);
  ensureOnWatch(onWatch);
}
