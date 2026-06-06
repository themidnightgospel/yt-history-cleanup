import { LOG_PREFIX } from "./log.js";
import { collectTokens, collectChannels, tokenCount } from "./tokens.js";
import { tryDecorateChannelButton } from "./channel-delete.js";

const ROW_SELECTOR = "yt-lockup-view-model, ytd-video-renderer";

export const INNERTUBE_BROWSE_MATCH = "/youtubei/v1/browse";

// Scrolled rows arrive via continuation POSTs to `/youtubei/v1/browse`.
// Wrap fetch in the page realm, clone each matching response, and feed it
// into the same token walker used for the initial payload.
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
            collectTokens(json);
            collectChannels(json);
            const added = tokenCount() - before;
            if (added > 0) {
              console.log(
                `${LOG_PREFIX} continuation added`,
                added,
                "tokens (total",
                tokenCount() + ")",
              );
            }
            // Channel info may have just arrived for already-decorated rows.
            // Sweep video rows and retry channel-button decoration.
            for (const row of document.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
              tryDecorateChannelButton(row);
            }
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
