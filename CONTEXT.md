# yt-history-cleanup — Context

Glossary for this project. Canonical meanings of terms that appear in code, docs, and UI copy. Implementation details belong elsewhere.

## Glossary

### history item

A single video row rendered on `https://www.youtube.com/feed/history`. Each row carries a thumbnail, title, channel, and a hidden `feedbackToken` used to remove it from watch history.

### feedbackToken

Opaque per-item token issued by YouTube. Required input to the `youtubei/v1/feedback` endpoint to remove a history item. Lives inside the item's DOM payload: `ytInitialData` for the initial render, and the lazy-load continuation payloads for items appended on scroll.
