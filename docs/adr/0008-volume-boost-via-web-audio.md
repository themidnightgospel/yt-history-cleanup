# ADR 0008: Volume boost in the player bar via a lazily attached Web Audio graph

## Status

Accepted — 2026-10-13

## Context

Some videos are mastered quietly: a lecture recorded on a laptop mic, an
old upload, a stream with the voice far below the game. At 100% on
YouTube's slider and 100% on the system mixer there is no headroom left,
and YouTube offers nothing above 100%.

YouTube's own slider and its arrow-key shortcuts already cover 0 to 100%,
so duplicating them in the bar was rejected. The gap is only above 100%.

Two ways to go louder than the media element's ceiling of 1.0 exist from
the page realm:

- **`video.volume`.** Capped at 1.0 by the spec. Not an option.
- **Web Audio.** `AudioContext.createMediaElementSource(video)` reroutes
  the element's output through a node graph, where a `GainNode` can
  multiply it. Two catches: an element can be captured only once and never
  released, and a context created without a user gesture may start
  suspended, which silences the captured element until resumed.

Multiplying audio that already peaks near full scale clips audibly. A
`DynamicsCompressorNode` with a high ratio and fast attack after the gain
acts as a limiter: loud passages are squashed instead of distorted, quiet
ones get the full boost. The node also applies automatic makeup gain
derived from its threshold and ratio: measured in Chrome, a −6 dBFS
threshold at 20:1 lifts everything by 3.4 dB (×1.48), even at gain 1.

## Decision

One `<button class="ytp-button">` with a speaker-plus icon is inserted in
`.ytp-right-controls`, directly left of the speed group (ADR 0007), or in
front of the captions / settings anchor if the speed group is not there
yet. Hovering or focusing it opens a row of three chips above the bar:
1.5×, 2×, 3×. Clicking a chip applies it; clicking the active chip returns
to 1×. Clicking the button itself turns the boost off, or back on at the
last stop used (2× before any). While boosted the button turns orange and
shows the multiplier, so the state is visible without hovering. Escape
closes the row. A mouse click gives up the focus it leaves on the button,
so the row closes once the pointer leaves; keyboard focus keeps it open.

The graph is `source → GainNode → DynamicsCompressorNode → destination`.
It is built on the first click that asks for a boost, never earlier, so
viewers who never use the feature have their audio untouched. Once built
it is kept for the life of that element; 1× then simply sets the gain to 1.
The compressor's threshold sits at 0 dBFS, where its makeup gain is
exactly 1: 1× stays at native loudness, each stop multiplies by what its
label says, and only boosted peaks past full scale are squashed. Gain
changes glide over a few milliseconds, since a step clicks audibly.
If YouTube swaps the video element, the old context is closed and a new
graph is built on the next boost.

The boost is not persisted. It resets to 1× whenever the `v=` parameter
changes or the user leaves the watch page: a boost is a judgement about
one quiet video, and carrying 3× into the next, normally mastered video
would be a jump scare. Re-routes within the same video keep it. The reset
runs as soon as the next video starts loading into the element, because
YouTube can start playing it before its route event fires.

While `#movie_player` carries YouTube's `ad-showing` class the gain is
held at 1× and restored when the class goes away. Ads are mastered loud.
The chosen stop stays highlighted throughout.

`#movie_player` carries `data-ythc-boost` with the chosen multiplier
whenever it is not 1×. Tests read it; Playwright cannot measure loudness.

## Consequences

**Positive.**

- Fixes quiet videos with one click per stop, which YouTube cannot do.
- No persisted state, so ADR 0006's trigger for a popup and
  `chrome.storage` is not reached, and `docs/privacy.md` is unchanged.
- Native mute and the native slider keep working: the boost multiplies
  whatever volume the user has set.

**Negative.**

- Capturing the element is irreversible for that element. If the graph
  breaks (context closed by the browser, a bug in our code), the video is
  silent until reload rather than merely unboosted.
- Any other extension that also calls `createMediaElementSource` on the
  same element (equalisers, other boosters) conflicts: whichever captures
  second throws. Ours logs a warning and leaves the audio alone; the
  button still shows the chosen stop but nothing is audible.
- Once the graph exists, every later video on that element still passes
  through it at 1×: transparent below full scale, plus the compressor's
  few-millisecond look-ahead delay. Accepted to avoid rewiring the graph on
  every toggle.
- Depends on `ad-showing`, `#movie_player` and `.ytp-right-controls`. If
  `ad-showing` is renamed, ads play boosted; nothing else breaks.
- Depends on the bar's stacking. YouTube's newer bar puts the progress
  bar above `.ytp-right-controls`, so the open row lifts the controls over
  it; without that, a click on a chip seeks the video instead. The button's
  rules are scoped to `#movie_player` to outrank YouTube's `.ytp-button`
  sizing, which would otherwise clip the multiplier.

**Revisit triggers.** A user asking for the boost to persist, a stop above
3×, or a report of conflicts with a popular audio extension.
