# yt-history-cleanup — Context

Glossary for this project. Canonical meanings of terms that appear in code, docs, and UI copy. Implementation details belong elsewhere.

## Glossary

### history item

A single video or short rendered on `https://www.youtube.com/feed/history`. Carries a thumbnail, title, channel, and a hidden `feedbackToken` used to remove it from watch history. May appear as a standalone row or as a card inside a `shorts shelf`.

### shorts shelf

A horizontal group of short `history items`, rendered as `<ytd-reel-shelf-renderer>`. YouTube groups shorts into shelves when several appear contiguously in the history feed. Each shelf item is a `<ytm-shorts-lockup-view-model>` (or `-v2`) card; a short can also appear outside a shelf as a regular `<ytd-video-renderer>` row.

### feedbackToken

Opaque per-item token issued by YouTube. Required input to the `youtubei/v1/feedback` endpoint to remove a history item. Lives inside the item's DOM payload: `ytInitialData` for the initial render, and the lazy-load continuation payloads for items appended on scroll.
