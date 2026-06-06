# Privacy Policy

**Effective date:** 2026-06-06
**Extension:** YouTube History Cleanup
**Contact:** bubachelidze1@gmail.com

## Summary

YouTube History Cleanup does not collect, store, or transmit any user data to any party. It runs entirely in your browser. The only network traffic it produces is requests sent directly to youtube.com on your behalf to delete history items.

## Data we collect

None. The extension does not collect, store, or transmit:

- Personally identifiable information
- Authentication credentials
- Browsing history
- Watch history contents
- Clicks, keystrokes, or other interaction telemetry
- Analytics or usage statistics of any kind

## Data we send

When you click a delete button, the extension reads the corresponding `feedbackToken` from the YouTube page and sends a `POST` request to `https://www.youtube.com/youtubei/v1/feedback` — the same endpoint YouTube's own UI uses for deletes. The request is authenticated using cookies already set by your browser for youtube.com. No data is sent to any other party.

## Permissions

- **Host permission for `youtube.com`** — required to call the delete endpoint and to read history items from the page DOM. The extension only activates on `https://www.youtube.com/feed/history`.

## Third parties

The extension contains no third-party SDKs, analytics, advertising, or tracking code. It does not communicate with any server other than youtube.com.

## Storage

The extension does not use `chrome.storage`, `localStorage`, `IndexedDB`, cookies, or any other persistence mechanism. It holds no state between page loads.

## Children

The extension does not knowingly process data from children. It does not collect data at all.

## Changes

If this policy changes, the new version will be published at the same URL with an updated effective date. The extension's behavior will not change in a way that collects user data without a corresponding update here.

## Source code

The extension is open source. Verify the claims above at:
https://github.com/themidnightgospel/yt-history-cleanup
