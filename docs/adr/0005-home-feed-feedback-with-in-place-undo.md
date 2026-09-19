# ADR 0005: Home-feed feedback actions replace the card in place and offer Undo

## Status

Accepted — 2026-09-19

## Context

Cleaning watch history is only half of keeping recommendations clean. The
other half is telling YouTube what not to show on the home feed. YouTube
offers two `feedback actions` for that — **Not interested** and **Don't
recommend channel** — but both live behind a hover, a 3-dot menu, and a
click. The same friction ADR 0001 removed for history deletes.

Each home-feed card ships both actions as `feedbackToken`s in its menu
payload, posted to the same `youtubei/v1/feedback` endpoint the history
delete uses. Unlike history tokens, these carry no `videoId` inside the
endpoint, so they are keyed by the card's own id (`contentId` on a
lockup, `videoId` on a classic renderer) and matched to the DOM through
the card's `/watch?v=` link.

ADR 0002 rules out undo for history deletes because YouTube exposes no
honest way to restore a history item. That reasoning does not transfer
here: the feedback endpoint's response carries a genuine **undo token** —
the same one YouTube's own "Video removed / Undo" card uses — and posting
it reverses the action exactly.

## Decision

Two always-visible icon buttons sit stacked in the top-right of each
card's thumbnail, below YouTube's hover overlay. A button appears only
when its token is known for that card, so a short shows one and a mix
shows none. There is no simulated-menu fallback; a card without a token
shows no button, consistent with ADR 0001.

Clicking a button posts the token immediately (no confirmation, per ADR
0002) and swaps the card's content for an in-place placeholder modelled
on YouTube's own: the message ("Video removed" / "We won't recommend
videos from this channel") and an **Undo** button. YouTube's "Tell us
why" survey button is deliberately omitted — it is a YouTube-internal
flow we cannot honestly reproduce.

Undo restores the card and posts the undo token from the response. If
Undo is pressed before the response arrives, the undo is sent as soon as
it lands. Placeholders persist until the next navigation, as YouTube's
do; a navigation clears them, since the feed reloads without those videos.

Failures are honest: if the request fails the card is restored and a
toast says so. If an undo cannot be sent (no token in the response, or
the undo request fails) the card is still restored visually and a toast
warns that YouTube may still hold the feedback.

## Consequences

**Positive.**

- One click instead of three, on the page where recommendation damage is
  most visible.
- Undo is real, not a replay hack, so the no-undo rule of ADR 0002 stays
  intact for the case it was written for.
- Reuses the signed feedback primitive and the token walkers; the only
  new network code is reading the undo token from the response.

**Negative.**

- Buttons permanently cover a small corner of every thumbnail.
- Label matching (`Not interested`, `Don't recommend channel`, `Undo`) is
  English-only. Non-English UIs get no buttons until the labels are
  localised.
- The placeholder is our DOM, not YouTube's; if YouTube re-binds a card
  element without navigating (topic-chip refresh), the placeholder is
  dropped when the card's video id changes, which is a heuristic.

**Revisit triggers.** If YouTube stops returning an undo token, the
placeholder loses its Undo and this decision should be reconsidered
against ADR 0002. If the buttons prove too intrusive, switch to
hover-only visibility before adding a preference — the extension keeps
no state (see `docs/privacy.md`).
