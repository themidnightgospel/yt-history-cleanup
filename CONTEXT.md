# yt-history-cleanup — Context

Glossary for this project. Canonical meanings of terms that appear in code, docs, and UI copy. Implementation details belong elsewhere.

## Glossary

### history item

A single video or short rendered on `https://www.youtube.com/feed/history`. Carries a thumbnail, title, channel, and a hidden `feedbackToken` used to remove it from watch history. May appear as a standalone row or as a card inside a `shorts shelf`.

### shorts shelf

A horizontal group of short `history items`, rendered as `<ytd-reel-shelf-renderer>`. YouTube groups shorts into shelves when several appear contiguously in the history feed. Each shelf item is a `<ytm-shorts-lockup-view-model>` (or `-v2`) card; a short can also appear outside a shelf as a regular `<ytd-video-renderer>` row.

### feedbackToken

Opaque per-item token issued by YouTube. Required input to the `youtubei/v1/feedback` endpoint to remove a history item. Lives inside the item's DOM payload: `ytInitialData` for the initial render, and the lazy-load continuation payloads for items appended on scroll.

### home feed card

A single recommendation rendered on `https://www.youtube.com/` as a `<ytd-rich-item-renderer>`. Wraps a video, short, mix, or playlist lockup plus its 3-dot menu. Identified by the video id in its `/watch?v=` or `/shorts/` link.

### feedback action

One of YouTube's two home-feed dismissals: **Not interested** (hide this video) and **Don't recommend channel** (hide this channel's videos). Each is a `feedbackToken` in the card's menu payload, posted to the same `youtubei/v1/feedback` endpoint as a history delete. Unlike history tokens, the endpoint carries no video id, so the token is keyed by the card's `contentId` / `videoId` and matched by label.

### undo token

A `feedbackToken` returned inside the response to a `feedback action`, labelled "Undo". Posting it reverses the action exactly. History deletes return none, which is why they have no undo (ADR 0002) while feedback actions do (ADR 0005).

### grayscale mode

The persisted on/off preference that desaturates thumbnails on the home feed and in the watch-page sidebar. Lives as the `ythc-grayscale` key in youtube.com `localStorage` (absent means on) and is mirrored as a `data-ythc-grayscale` attribute on `<html>`, which `content.css` keys its filter off. Toggled by the round button at the front of the masthead's right-hand controls (ADR 0006).
