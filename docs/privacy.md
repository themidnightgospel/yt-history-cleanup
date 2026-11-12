# Privacy Policy

**Effective date:** 2026-11-12
**Extension:** YouTube Productivity Kit (formerly YouTube History Cleanup)
**Contact:** bubachelidze1@gmail.com

## Summary

YouTube Productivity Kit does not collect, store, or transmit any user data to any party. It runs entirely in your browser. The only network traffic it produces is requests sent directly to youtube.com on your behalf to delete history items or to mark home-feed recommendations as not interested, and to undo the latter.

## Data we collect

None. The extension does not collect, store, or transmit:

- Personally identifiable information
- Authentication credentials
- Browsing history
- Watch history contents
- Clicks, keystrokes, or other interaction telemetry
- Analytics or usage statistics of any kind

## Data we send

When you click a delete button, or a "Not interested" / "Don't recommend channel" button on the home feed, the extension reads the corresponding `feedbackToken` from the YouTube page and sends a `POST` request to `https://www.youtube.com/youtubei/v1/feedback` — the same endpoint YouTube's own UI uses for these actions. Pressing Undo sends the undo token YouTube returned in the same way. The request is authenticated using cookies already set by your browser for youtube.com. No data is sent to any other party.

## Permissions

- **Host permission for `youtube.com`** — required to call the feedback endpoint and to read history items and home-feed cards from the page DOM. Buttons are injected on `https://www.youtube.com/feed/history` and `https://www.youtube.com/`; on watch pages the extension adds playback speed and volume boost controls to the video player's control bar; the grayscale style and the header toggles for grayscale and watch check-ins apply on every youtube.com page. Watch check-ins read the video's playback position and its category (to skip music and live streams) from the page; none of this leaves your browser. When you turn the volume boost on, the extension routes that video's sound through your browser's built-in Web Audio API to amplify it. This happens entirely inside your browser: the audio is never recorded, stored, or sent anywhere.

## Third parties

The extension contains no third-party SDKs, analytics, advertising, or tracking code. It does not communicate with any server other than youtube.com.

## Storage

The extension stores exactly three values: whether grayscale thumbnails are on or off, whether watch check-ins are on or off, and the optional relax time for check-ins (a start and end time of day), kept as the keys `ythc-grayscale`, `ythc-checkin` and `ythc-checkin-quiet` in youtube.com's `localStorage`. They contain no personal data and the extension never transmits them. Because they live in youtube.com's own site storage, YouTube's page scripts could technically read these three settings. Clearing youtube.com site data resets it. The extension does not use `chrome.storage`, `IndexedDB`, cookies, or any other persistence mechanism, and holds no other state between page loads, with one short-lived exception: when you close a video from a watch check-in, the video's id, title and position are kept in that tab's `sessionStorage` for the 5 seconds the Undo is offered, and removed as soon as they are read. Closing the tab discards them.

## Children

The extension does not knowingly process data from children. It does not collect data at all.

## Changes

If this policy changes, the new version will be published at the same URL with an updated effective date. The extension's behavior will not change in a way that collects user data without a corresponding update here.

## Source code

The extension is open source. Verify the claims above at:
https://github.com/themidnightgospel/yt-history-cleanup
