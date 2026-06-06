# ADR 0002: Delete actions fire immediately with no confirmation and no undo

## Status

Accepted — 2026-06-06
Amended — 2026-06-06 (batch delete feature removed; decision applies only to the per-row trash icon)

## Context

The extension exposes one destructive action: a per-row trash icon on each history item.

The motivating use case is **cleaning up watch history that has polluted the YouTube recommendation algorithm** — the user deliberately scrubs entries they regret watching. Confirmation dialogs add friction to a task that is, by intent, repetitive: open history, pick junk, delete, repeat.

Undo is also technically expensive. YouTube exposes no "restore history item" endpoint. The only way to re-add an item is to load `/watch?v=X` in a hidden iframe, which silently re-watches it and mutates the original watch position and timestamp. The undo would not be honest — it would create a near-but-not-identical history entry.

## Decision

Single-click on the row trash icon deletes immediately. No confirmation dialog. No undo affordance. Failures surface as a non-blocking toast.

## Consequences

**Positive.**

- Code stays small. No dialog state, no undo buffer, no iframe-replay logic.
- Honest failure model: a deletion is either successful or surfaced as a toast — never half-true.

**Negative.**

- A misclick on the row trash icon is irrecoverable. Misclicks are most likely during fast scrolling.

**Mitigations available without violating the decision.**

- The per-row icon stays small (~18 px) to reduce hit area for accidental clicks during scroll.

**Revisit triggers.** If the user reports a real "I lost a video I wanted" incident, retrofit a 5-second toast-with-undo. Until that incident, the decision stands.
