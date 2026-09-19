import { LOG_PREFIX } from "./log.js";
import { collectTokens, collectChannels, tokenCount } from "./tokens.js";
import { collectHomeTokens, homeTokenCount } from "./home-tokens.js";
import { tryDecorateChannelButton } from "./channel-delete.js";
import { isOnHistory } from "./dom.js";
import { decorateAllHomeCards, isOnHome } from "./home-feed.js";

const ROW_SELECTOR = "yt-lockup-view-model, ytd-video-renderer";

export const INNERTUBE_BROWSE_MATCH = "/youtubei/v1/browse";

// Scrolled rows arrive via continuation POSTs to `/youtubei/v1/browse`.
// Wrap fetch in the page realm, clone each matching response, and feed it
// into the same token walkers used for the initial payload.
export function patchFetchForContinuations(): void {
  const origFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const res = await origFetch(input, init);
    try {
      const url = urlOf(input);
      if (url.includes(INNERTUBE_BROWSE_MATCH)) {
        res
          .clone()
          .json()
          .then((json) => {
            const before = tokenCount();
            const homeBefore = homeTokenCount();
            collectTokens(json);
            collectChannels(json);
            collectHomeTokens(json);
            const added = tokenCount() - before;
            const homeAdded = homeTokenCount() - homeBefore;
            if (added > 0) {
              console.log(
                `${LOG_PREFIX} continuation added`,
                added,
                "tokens (total",
                tokenCount() + ")",
              );
            }
            if (homeAdded > 0) {
              console.log(
                `${LOG_PREFIX} continuation added`,
                homeAdded,
                "home cards (total",
                homeTokenCount() + ")",
              );
            }
            // Channel info may have just arrived for already-decorated rows.
            // Sweep video rows and retry channel-button decoration. Gated by
            // route: home-feed lockups match ROW_SELECTOR too.
            if (isOnHistory()) {
              for (const row of document.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
                tryDecorateChannelButton(row);
              }
            }
            // Likewise home cards that rendered before their tokens landed.
            if (isOnHome()) decorateAllHomeCards();
          })
          .catch((err) => console.debug(`${LOG_PREFIX} continuation parse failed`, err));
      }
    } catch {
      // swallow — fetch wrapper must never break the page
    }
    return res;
  };
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}
