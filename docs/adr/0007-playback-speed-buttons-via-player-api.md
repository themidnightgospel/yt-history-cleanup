# ADR 0007: Playback speed buttons in the player bar, driven by the player API

## Status

Accepted — 2026-09-19

## Context

Changing playback speed on YouTube takes three clicks through the gear
menu. Four fixed speeds (1.25, 1.5, 1.75, 2) cover almost every use, so
they deserve one click each, in the bottom bar next to the controls the
user already hovers for.

Two ways to change the rate exist from the page realm:

- **The media element.** Set `video.playbackRate`. Simple, but YouTube's
  player keeps its own notion of the current rate, shown in the gear menu
  and remembered across videos in the session. Writing to the element
  alone leaves the gear menu stale and lets the player overwrite the rate
  on the next video or ad boundary.
- **The player API.** The `#movie_player` element exposes
  `setPlaybackRate` / `getPlaybackRate` (the same API the gear menu uses).
  It is undocumented for extensions but stable for years, and it keeps
  YouTube's state in agreement.

Since the content script runs in the MAIN world (ADR 0001 chose that for
the feedback endpoint), the API is directly reachable.

## Decision

A group of four `<button class="ytp-button">` elements is inserted in
`.ytp-right-controls` immediately before the captions button (falling
back to the settings button, then to the front of the group). Using
YouTube's own `ytp-button` class gives the bar's height, hover opacity
and focus ring for free; the extension only styles the text.

Clicks call `setPlaybackRate`, falling back to `video.playbackRate` if
the API is missing. The active button is derived from the real rate and
re-synced on the media element's `ratechange` event, so changes made via
the gear menu or the `<` / `>` shortcuts are reflected. Clicking the
active speed returns to normal speed, so the bar never needs a "1×"
button. A speed not on the bar (0.75, custom) shows no active button.

The group is only created on the watch page. The player element may be
stamped after the script, so a one-shot observer waits for it there and
is disconnected elsewhere. In the player's compact mode the group is
hidden so essential controls keep their room.

## Consequences

**Positive.**

- One click per speed, no menu. Visually indistinguishable from native
  controls.
- YouTube's gear menu, per-session speed memory and shortcuts all stay
  consistent because the same API is used.
- No persisted state: the rate is YouTube's to remember.

**Negative.**

- Depends on `#movie_player`, `.ytp-right-controls` and the captions /
  settings button classes. A rename hides the group until the selectors
  are updated; nothing else breaks.
- `setPlaybackRate` is not a public contract. If it disappears the
  media-element fallback still changes the rate but the gear menu may
  disagree.
- The fixed speed list is not configurable. A preference would need
  storage, and ADR 0006 says the next preference should move the
  extension to a popup with `chrome.storage`.

**Revisit triggers.** A user asking for 0.75 or 3×, or YouTube shipping
its own quick-speed control in the bar.
