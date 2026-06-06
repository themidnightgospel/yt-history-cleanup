# ADR 0003: Shelf delete-all leaves one card per round until the final page

## Status

Accepted — 2026-06-06

## Context

The shelf-level **Delete all** button on a `shorts shelf` (`<ytd-reel-shelf-renderer>`) iterates: delete the visible cards, click the shelf's right-arrow to fetch the next continuation page, repeat until the right-arrow is disabled.

YouTube has a load-bearing rendering quirk: **a shelf with zero cards collapses**. When the shelf has no `<ytm-shorts-lockup-view-model[-v2]>` children, YT removes the right-arrow (and often the entire `#header`) from the DOM. Once the right-arrow is gone, we cannot trigger the next continuation fetch, and any tokens for the unloaded pages stay unreachable.

A pre-load-all alternative (click right-arrow until disabled, *then* delete every card) avoids the collapse issue but blows past whatever pre-render cap YT enforces on the carousel and risks unloading off-screen cards under memory pressure.

## Decision

Each round of the delete-all loop leaves exactly one card in the shelf when the right-arrow is enabled. On the round where the right-arrow is disabled (last page), the loop deletes every remaining card.

Concretely:

```
loop:
  next = enabled right-arrow?
  cards = shelf's current shorts
  toDelete = next ? cards.slice(0, -1) : cards   // ← key line
  chunkedShelfDelete(toDelete)
  if !next: break
  next.click(); await waitForNewCards(shelf)
```

## Consequences

**Positive.**

- Shelf stays alive across rounds. The right-arrow is always reachable.
- DOM size is bounded — we delete in flight rather than pre-loading hundreds of cards.

**Negative.**

- One stray card survives to the final page where it is finally deleted. If the loop is interrupted mid-flight (refresh, error), the user sees that survivor and may wonder why one is left.
- Loop has a max-rounds safety cap (50) to prevent infinite loops if YT misreports the arrow state. A shelf with >50 × pageSize hidden shorts terminates early.

**Revisit triggers.** If YT changes the empty-shelf rendering to keep the right-arrow alive, the workaround is no longer load-bearing and the `.slice(0, -1)` can drop. If YT introduces a real bulk-shelf-delete endpoint, retire the loop entirely.
