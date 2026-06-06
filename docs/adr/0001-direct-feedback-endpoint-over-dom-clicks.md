# ADR 0001: Use direct `youtubei/v1/feedback` POST instead of simulated 3-dot menu clicks

## Status

Accepted — 2026-06-06

## Context

The extension needs to remove items from a user's YouTube watch history. YouTube ships no public API for this. Two mechanisms are available:

- **Path A — Simulated DOM clicks.** Programmatically open each item's 3-dot menu, then click the "Remove from watch history" entry. Relies on stable selectors and rendered menu DOM.
- **Path B — Direct internal endpoint.** Each history item ships with an opaque `feedbackToken`. Posting it to `https://www.youtube.com/youtubei/v1/feedback` removes the item. The request must carry the user's auth cookies and a `SAPISIDHASH` header computed as `SHA1(timestamp + " " + SAPISID + " " + origin)`.

Batch deletion needs to feel snappy — tens of items at once. Path A measures ~200–500 ms per item due to menu open/close cycles and visible UI flicker. Path B measures ~50–100 ms per item and parallelises cleanly.

## Decision

Use Path B. Extract `feedbackToken` from each item's DOM payload, compute `SAPISIDHASH` from the `SAPISID` cookie at call time, and POST to `youtubei/v1/feedback`. Batches fan out in chunks of 5 parallel requests.

## Consequences

**Positive.**

- Batches of 50 complete in seconds, not minutes.
- No visible menu flicker during batch deletion.
- Network code is independent of YouTube's class names and aria-labels.

**Negative.**

- A future reader will see SHA1 of a cookie value and wonder why. This ADR is the answer.
- If YouTube changes the token format or endpoint shape, every delete breaks at once. Path A would degrade more gradually.
- The `SAPISIDHASH` computation is reverse-engineered, not documented. Brittle to auth pipeline changes.

**Fallback plan.** Keep the public delete primitive single-call (`deleteHistoryItem(token)`) so a future swap to Path A is localised behind one function.
