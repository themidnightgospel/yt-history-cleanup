# ADR 0010: Hidden recommendations with a one-minute peek

## Status

Accepted — 2026-11-17

## Context

Most autopilot watching starts from a recommendation. You open YouTube to
look up one thing, the home grid catches your eye, and the thing you came
for is forgotten. Or a video ends and the "Up next" sidebar has the next
one lined up. Grayscale (ADR 0006) makes these calmer but leaves them
there.

The user asked for a header toggle that hides the home page's
recommendations, where showing them is only ever temporary: they come back
hidden by itself after one minute. Four looks for the hidden page and
three for the button were prototyped. The user chose a search box asking
"What did you come here for?" and a button that becomes a countdown pill.
Right after, they asked for the watch page's sidebar to be included.

## Decision

**What is hidden.** One state covers both pages, keyed on a
`data-ythc-feed-hidden` attribute on `<html>` together with the existing
`data-ythc-page`:

- On the home page, `ytd-rich-grid-renderer`: the grid together with its
  chips bar and Shorts shelf. Subscriptions and channel pages use the same
  element, hence the page key. The masthead, search box and side menu stay.
- On a watch page, `ytd-watch-next-secondary-results-renderer` (the "Up
  next" list, in the sidebar or under the video in a narrow window), the
  wall of suggestions at the end of a video (`.html5-endscreen.videowall-endscreen`)
  and the grid under the video in fullscreen (`.ytp-fullscreen-grid`). A
  playlist panel is a separate element and stays, as do the creator's own
  end cards.

**What shows instead.** On the home page a prompt is inserted just before
the grid: "What did you come here for?", a search box, and one line saying
how to show the feed. Submitting goes to YouTube's search results for the
answer. YouTube keeps every visited feed's `<ytd-browse>` alive, so the
prompt attaches only to the grid inside `ytd-browse[page-subtype="home"]`.
On a watch page a one-line note takes the top of the "Up next" list's
place.

**The button.** An eye-with-a-slash button in the masthead, after the
zombie button. Clicking it shows recommendations for one minute, on
whichever page you are or go to. Meanwhile the button turns into a yellow
pill with the time left (`0:42`). Clicking the pill hides them at once.
When the minute runs out they hide even if you are looking at them, with
a short toast on the home and watch pages.

**Hidden is the resting state and cannot be switched off for good.** It is
on for everyone, existing users included. The only stored value is when
the current peek ends, as epoch milliseconds in youtube.com `localStorage`
under `ythc-feed-shown-until`. So a reload does not grant a fresh minute,
and other youtube.com tabs follow the same timer through the `storage`
event. A stored end more than one minute away cannot have come from the
button (the clock moved, or someone edited it), so it counts as hidden.

## Consequences

**Positive.**

- No new permission. One module, CSS, and a fourth `localStorage` key.
- Seeing recommendations takes a deliberate click and lasts a known,
  short time. The prompt turns the empty home page into the question the
  feature is about.

**Negative.**

- Existing users find their home page empty and their sidebar gone after
  the update. The prompt and the note explain it, and the store listing's
  "what's new" should too.
- YouTube's autoplay still starts the next video when one ends; hiding the
  list does not switch autoplay off. The user chose to keep it that way;
  watch check-ins still catch autoplayed videos.
- Depends on `ytd-rich-grid-renderer`, `ytd-browse[page-subtype]`,
  `ytd-watch-next-secondary-results-renderer` and the player's end-screen
  classes. If YouTube renames one, that part shows normally; nothing else
  breaks.
- The search from the prompt is a full page load, not YouTube's in-app
  navigation.
- Without `localStorage` the button still works for the life of the page,
  but every reload starts hidden.

**Revisit triggers.** A request for a different peek length, for a way to
keep recommendations visible, or for separate home and sidebar switches
(all need settings, see ADR 0006); a request to switch autoplay off too;
or YouTube moving these lists to other elements.
