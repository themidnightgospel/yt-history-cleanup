# ADR 0006: Grayscale thumbnails via a CSS flag, toggled in-page and persisted in localStorage

## Status

Accepted — 2026-09-19

## Context

Thumbnails are engineered to pull attention. Desaturating them on the home
feed and in the watch-page sidebar makes the feed calmer without hiding
anything. The user must be able to turn this off, so the extension needs
its first persisted preference.

Until now the extension held no state at all, and `docs/privacy.md` says
so. Three ways to hold one boolean were considered:

- **Popup + `chrome.storage`.** The proper extension pattern. Needs the
  `storage` permission, a popup page, and an isolated-world script to
  relay the value into the page, since the content script runs in the MAIN
  world where `chrome.*` is unavailable.
- **In-page toggle + `localStorage` on youtube.com.** No new permission and
  no popup. The toggle lives in YouTube's masthead where the user already
  looks. Adds one key to youtube.com's origin storage.
- **Always on.** No state, but no way to opt out short of disabling the
  extension.

## Decision

Grayscale is a CSS effect keyed off a `data-ythc-grayscale` attribute on
`<html>`. `content.css` applies `filter: grayscale(1)` to thumbnail images
and inline-preview videos inside home-feed cards and the watch-page
sidebar, and lifts it while the card is hovered so a deliberately examined
thumbnail is seen in color.

The attribute is set from a single `localStorage` key, `ythc-grayscale`,
on the youtube.com origin. An absent key means on; the feature defaults on.
A round icon button inserted at the front of the masthead's right-hand
button group toggles it, with `aria-pressed` reflecting the state.

## Consequences

**Positive.**

- No new permission, no popup, no isolated/MAIN bridge. The whole feature
  is one small module plus CSS.
- The toggle is discoverable where YouTube's own controls are.
- The effect follows the user across SPA navigations for free: the
  attribute lives on `<html>`, which YouTube never replaces.

**Negative.**

- The extension now persists one preference. `docs/privacy.md` is updated
  to say exactly that. Clearing youtube.com site data resets it to on.
- Injecting into the masthead depends on `ytd-masthead #end` existing. If
  YouTube renames it the toggle disappears, though the effect itself keeps
  working from the stored value.
- The preference does not sync across devices the way `chrome.storage.sync`
  would.

**Revisit triggers.** If a second preference is ever needed, move to the
popup + `chrome.storage` pattern rather than growing a settings panel
inside YouTube's DOM. If YouTube's thumbnail markup changes, only the
selector list in `content.css` needs updating.
