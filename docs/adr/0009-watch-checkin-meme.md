# ADR 0009: Watch check-in: a meme that pauses the video and asks

## Status

Accepted — 2026-11-12

## Context

A familiar pattern: you click a video on autopilot and keep watching.
Then you pause it for a few seconds, come back, and wonder why you were
watching it at all, and close it. The pause is what breaks the trance.
This feature creates those pauses on purpose.

The design was settled with the user in a grilling session:

- A plain "are you sure?" dialog gets dismissed on reflex, which is the
  very autopilot it is meant to catch. A meme with rotating captions is
  read, because it is different each time. Real meme photos are
  copyrighted, so the format is rebuilt with emoji and text.
- People also listen to videos while doing something else. A check-in
  that waits for an answer would stop the audio until they walk back to
  the screen.

## Decision

**When.** A check-in comes after 1 minute of playback on a video, then
after every further 10 minutes. The clock is video time while playing,
read from `timeupdate`: paused time, ads (`ad-showing` on the player) and
seeks (the `seeking` event, plus jumps of 5 s or more as a safety net) do
not count, and at 2×
speed the marks come twice as fast. A check-in also comes when the user
presses play after a pause of their own that lasted 30 s or more.

**What.** The video pauses and a meme fills the player: Impact-font top
and bottom captions over a swaying emoji, with "On purpose" and
"Zombie. Close it." About 15 captions rotate at random without repeats;
some use the real minutes watched (time played, not the position in the
video, which a link can start at 40:00) and only appear once that many
have passed, and two are reserved for the come-back-from-a-pause check-in. The
overlay lives inside `#movie_player`, so it also shows in fullscreen.

**Answers.**

- "On purpose", pressing play, or no answer within 12 s (a draining bar
  shows the time) all mean keep watching: the video resumes and the next
  check-in is 10 minutes of playback away.
- "Don't ask for this one", a quiet link under the two buttons, resumes
  the video and silences every further check-in for it, including the
  come-back-from-a-pause one. The next video starts fresh. It is an easy
  way out of the question, accepted because a lecture or a long podcast
  you chose should not be asked about six times.
- "Zombie. Close it." navigates to the home page. There, a toast offers
  Undo for 5 s from when it appears; a close older than 30 s, say a
  reload that never finished, offers none. Undo returns to the same video at the same
  second, paused, and counts as keep watching. A full navigation is used
  both ways, so the Undo details cross the reload through the tab's
  `sessionStorage` (`ythc-checkin-undo`, then `ythc-checkin-resume`),
  each read once and removed. The paused landing waits up to 8 s for
  YouTube's autoplay and then gives up, so a later play by the user is
  never undone.

**Skipped.** Videos in the Music category or live right now
(`videoDetails.isLive` or `liveBroadcastDetails.isLiveNow` from the
player's `getPlayerResponse()`; a finished stream's recording is an
ordinary video), the user's relax time, any URL with `list=` (a playlist
or mix the user opened; autoplay's Up Next has no `list=`), anything off
the watch page (the miniplayer keeps the element playing), and while the
tab is hidden: a scheduled check-in that comes due then waits until the
tab is visible, while a come-back-from-a-pause one lapses, since it would
be stale by then.

**Settings.** A round button in the masthead showing an outlined zombie shuffling arms-out, right after the
grayscale toggle, opens a panel laid out like YouTube's own account menu:
an icon row with a pill switch for check-ins (on by default), and a
"Relax time" row showing the current range that unfolds to its own
switch and From / To pickers in half-hour steps, labelled in the user's
clock format. Relax time is off by default and prefilled 21:00 to
06:00. A range whose start is later than its end wraps past midnight. During relax time no check-in fires; the clock keeps
counting, so one may come soon after they end. Both settings live in
youtube.com `localStorage` (`ythc-checkin`, and `ythc-checkin-quiet` as
JSON), the same mechanism as grayscale (ADR 0006, amended for this).
Turning check-ins off during one resumes the video; turning them back on
counts from then. The intervals are fixed.

## Consequences

**Positive.**

- No new permission. Two small modules, CSS and a shared toast that can
  now carry one action.
- Background listening is never blocked for more than 12 s, and a hidden
  tab is never paused at all.

**Negative.**

- Depends on the `<video>` element's events, `#movie_player`,
  `getPlayerResponse()` and `ad-showing`. If the player response is
  missing, music and live videos get check-ins too; nothing else breaks.
- The close and the Undo each reload the page, about a second each,
  because YouTube's in-app navigation cannot be driven reliably from
  outside. Without `sessionStorage` the close still works, without Undo.
- A mix opened from the home feed carries `list=` and is treated as a
  deliberate playlist, so it gets no check-ins.
- Emoji render differently per platform; the captions do not depend on
  the exact glyph.

**Revisit triggers.** A request for adjustable intervals (needs the
settings popup from ADR 0006), YouTube changing autoplay to carry a
playlist parameter, or the captions growing stale.
