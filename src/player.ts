// Shared access to YouTube's `#movie_player` for the bottom-bar features
// (speed buttons, volume boost): element lookup, where our groups go in
// the right-hand controls, and a one-shot wait for a late-stamped player.

const PLAYER_SELECTOR = "#movie_player";
const RIGHT_CONTROLS_SELECTOR = ".ytp-right-controls";
// Our groups go in front of the first of these that exists.
const ANCHOR_SELECTOR = ".ytp-subtitles-button, .ytp-settings-button";
const MAIN_VIDEO_SELECTOR = "video.html5-main-video";

export function player<T extends HTMLElement = HTMLElement>(): T | null {
  return document.querySelector<T>(PLAYER_SELECTOR);
}

export function videoOf(p: HTMLElement): HTMLVideoElement | null {
  // Two lookups, not the list "video.html5-main-video, video": a selector
  // list returns whichever <video> comes first in the document.
  return (
    p.querySelector<HTMLVideoElement>(MAIN_VIDEO_SELECTOR) ?? p.querySelector<HTMLVideoElement>("video")
  );
}

export function rightControls(p: HTMLElement): HTMLElement | null {
  return p.querySelector<HTMLElement>(RIGHT_CONTROLS_SELECTOR);
}

/**
 * Inserts `group` into `controls` as a sibling of YouTube's own cluster,
 * in front of `before` if given, else in front of the captions / settings
 * anchor (climbing out of any sub-container newer layouts wrap it in),
 * else first.
 */
export function insertGroup(
  controls: HTMLElement,
  group: HTMLElement,
  before: HTMLElement | null = null,
): void {
  let slot: HTMLElement | null = before ?? controls.querySelector<HTMLElement>(ANCHOR_SELECTOR);
  while (slot && slot.parentElement !== controls) slot = slot.parentElement;
  controls.insertBefore(group, slot ?? controls.firstChild);
}

/**
 * Returns a per-feature "called on every route" initialiser. On the watch
 * page the player and its controls may stamp after us, so `ensure` is
 * retried from a body observer until it succeeds; elsewhere the wait is
 * cancelled.
 */
export function playerFeature(ensure: () => boolean): (onWatch: boolean) => void {
  let waiting: MutationObserver | null = null;
  const stop = (): void => {
    waiting?.disconnect();
    waiting = null;
  };
  return (onWatch: boolean): void => {
    if (!onWatch) {
      stop();
      return;
    }
    if (ensure()) {
      stop();
      return;
    }
    if (waiting || !document.body) return;
    waiting = new MutationObserver(() => {
      let done: boolean;
      try {
        done = ensure();
      } catch (err) {
        // Waiting on would rethrow on every mutation; the next route retries.
        stop();
        throw err;
      }
      if (done) stop();
    });
    waiting.observe(document.body, { childList: true, subtree: true });
  };
}
