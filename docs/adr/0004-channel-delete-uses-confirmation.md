# ADR 0004: Channel-wide delete uses a confirmation dialog

## Status

Accepted — 2026-06-06

## Context

The new per-row "delete all videos of this channel" button triggers a
scroll-and-fetch loop that can remove tens to hundreds of entries from the
user's watch history, scrolling the page to load further continuations until
either the chosen date cutoff or the end of history is reached.

ADR 0002 establishes a no-confirmation, no-undo policy for delete actions.
That policy assumed each click destroys exactly one row (per-row trash icon)
or one visible group (shelf delete-all). A channel-wide delete is
fundamentally different — its blast radius depends on payload data the user
cannot fully see (their own watch history beyond the loaded viewport).

## Decision

Channel-wide delete opens a modal `<dialog>` showing the channel display
name in the title and a single dropdown of date cutoffs (`Today`,
`Last 7 days`, `Last 30 days`, `Last 90 days`, `Last year`, `All time`).
The action does not begin until the user clicks **Confirm**. Cancel
dismisses without side effect.

After confirmation, the dialog is reused as a progress panel showing live
counters and a **Cancel** button that aborts the loop mid-flight.

This narrowly carves out an exception from ADR 0002. Per-row trash and
shelf delete-all keep the no-confirm policy.

## Consequences

**Positive.**

- The user sees the blast radius (the channel name + the date cutoff) before
  authorising the action. Misclicks on the row-level icon don't cascade into
  hundreds of deletions.
- Cancel mid-flight is honest: the loop stops cleanly at the next chunk
  boundary, leaving everything already deleted gone, but everything else
  intact.

**Negative.**

- A second UI pattern (confirm-then-act) now coexists with the bare
  trash-and-go pattern used everywhere else. Future contributors must
  understand when each applies.
- Native `<dialog>` styling depends on browser defaults; the polish ceiling
  is limited without rewriting as a custom div overlay.

**Revisit triggers.** If a per-row no-confirm action ever picks up
similarly-large blast radius (e.g. a future "delete entire date section"
button), it should adopt this confirm pattern too. If the dialog turns out
to be too friction-heavy for the rapid-scrub workflow, a "skip confirmation"
preference could be added — but only after measuring the friction, not
preemptively.
