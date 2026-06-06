import { describe, it, expect, beforeEach } from "vitest";
import {
  collectTokens,
  collectChannels,
  videoIdFromFeedbackActions,
  getFeedbackToken,
  getVideoId,
  getChannelId,
  buildInitialTokenMap,
  clearTokens,
  tokenCount,
  channelCount,
} from "./tokens.js";
import synthetic from "../tests/fixtures/synthetic-history.json" with { type: "json" };
import captured from "../tests/fixtures/captured-history.json" with { type: "json" };

beforeEach(() => clearTokens());

describe("videoIdFromFeedbackActions", () => {
  it("reads videoId from hideItemSectionVideosByIdCommand", () => {
    expect(videoIdFromFeedbackActions(synthetic.viaHideItemSection)).toBe("vidHideItem");
  });

  it("reads videoId from localWatchHistoryCommand", () => {
    expect(videoIdFromFeedbackActions(synthetic.viaLocalWatchHistory)).toBe("vidLocalHist");
  });

  it("prefers hideItemSectionVideosByIdCommand over localWatchHistoryCommand", () => {
    expect(videoIdFromFeedbackActions(synthetic.preferHideOverLocal)).toBe("vidPreferred");
  });

  it("returns null when actions is missing", () => {
    expect(videoIdFromFeedbackActions(synthetic.noActions)).toBeNull();
  });

  it("returns null when actions is empty", () => {
    expect(videoIdFromFeedbackActions(synthetic.actionsEmpty)).toBeNull();
  });

  it("returns null when no known command is present", () => {
    expect(videoIdFromFeedbackActions(synthetic.actionUnknownShape)).toBeNull();
  });
});

describe("collectTokens", () => {
  it("walks deeply nested objects and registers tokens", () => {
    collectTokens(synthetic.nestedDeep);
    expect(tokenCount()).toBe(1);
  });

  it("registers multiple distinct videoIds across siblings", () => {
    collectTokens({
      a: synthetic.viaHideItemSection,
      b: synthetic.viaLocalWatchHistory,
    });
    expect(tokenCount()).toBe(2);
  });

  it("ignores feedbackTokens with no resolvable videoId", () => {
    collectTokens({
      x: synthetic.noActions,
      y: synthetic.actionsEmpty,
      z: synthetic.actionUnknownShape,
    });
    expect(tokenCount()).toBe(0);
  });

  it("does not overwrite an existing token for the same videoId", () => {
    collectTokens(synthetic.viaHideItemSection);
    const first = tokenCount();
    collectTokens(synthetic.viaHideItemSection);
    expect(tokenCount()).toBe(first);
  });

  it("is null-safe on garbage input", () => {
    expect(() => collectTokens(null)).not.toThrow();
    expect(() => collectTokens(undefined)).not.toThrow();
    expect(() => collectTokens(42)).not.toThrow();
    expect(() => collectTokens("string")).not.toThrow();
  });
});

describe("getVideoId / getFeedbackToken (DOM)", () => {
  function makeRow(href: string | null): HTMLElement {
    const row = document.createElement("div");
    if (href) {
      const link = document.createElement("a");
      link.href = href;
      row.appendChild(link);
    }
    return row;
  }

  it("extracts videoId from a /watch?v= link", () => {
    const row = makeRow("https://www.youtube.com/watch?v=abc123XYZ");
    expect(getVideoId(row)).toBe("abc123XYZ");
  });

  it("extracts videoId from a /shorts/ link", () => {
    const row = makeRow("https://www.youtube.com/shorts/SHORT_abc-1");
    expect(getVideoId(row)).toBe("SHORT_abc-1");
  });

  it("extracts videoId from a relative /shorts/ link", () => {
    const row = document.createElement("div");
    const link = document.createElement("a");
    link.setAttribute("href", "/shorts/REL_short99");
    row.appendChild(link);
    expect(getVideoId(row)).toBe("REL_short99");
  });

  it("returns null when no /watch?v= link is present", () => {
    const row = makeRow(null);
    expect(getVideoId(row)).toBeNull();
  });

  it("returns null when row has unrelated links only", () => {
    const row = document.createElement("div");
    const link = document.createElement("a");
    link.href = "https://www.youtube.com/channel/UC_FOO";
    row.appendChild(link);
    expect(getVideoId(row)).toBeNull();
  });

  it("looks up token by videoId after population", () => {
    collectTokens(synthetic.viaHideItemSection);
    const row = makeRow("https://www.youtube.com/watch?v=vidHideItem");
    expect(getFeedbackToken(row)).toBe("TOKEN_VIA_HIDE_ITEM");
  });

  it("returns null when token map has no entry for the row's videoId", () => {
    const row = makeRow("https://www.youtube.com/watch?v=unknownVid");
    expect(getFeedbackToken(row)).toBeNull();
  });
});

describe("buildInitialTokenMap", () => {
  it("does nothing when window.ytInitialData is absent", () => {
    window.ytInitialData = undefined;
    buildInitialTokenMap();
    expect(tokenCount()).toBe(0);
  });

  it("walks window.ytInitialData when present", () => {
    window.ytInitialData = synthetic.nestedDeep;
    buildInitialTokenMap();
    expect(tokenCount()).toBe(1);
  });
});

// Canary: feeds the walker a scrubbed snapshot derived from a real
// ytInitialData payload. If YouTube renames `hideItemSectionVideosByIdCommand`
// or `localWatchHistoryCommand`, the walker stops finding tokens and this
// fails — surfaces the drift before users hit it.
describe("collectChannels", () => {
  it("pairs videoId with the first UC-prefixed browseId in the same subtree", () => {
    const lockup = {
      contentId: "abc12345_XY",
      metadata: {
        bylineText: {
          commandRuns: [
            {
              onTap: {
                browseEndpoint: {
                  browseId: "UCsomeChannel111111111X",
                  canonicalBaseUrl: "/@someChannel",
                },
              },
            },
          ],
        },
      },
    };
    collectChannels({ root: [lockup] });
    expect(channelCount()).toBe(1);
  });

  it("ignores contentIds without a UC-prefixed browseId nearby", () => {
    const lockup = {
      contentId: "abc12345_XY",
      // No browseId anywhere — just a playlist endpoint
      onTap: { watchEndpoint: { playlistId: "PL999" } },
    };
    collectChannels({ root: [lockup] });
    expect(channelCount()).toBe(0);
  });

  it("indexes channels via getChannelId after collection", () => {
    collectChannels({
      contentId: "VIDX_lookup",
      onTap: { browseEndpoint: { browseId: "UCxxxxxxxxxxxxxxxxxxxxxx" } },
    });
    const row = document.createElement("div");
    const link = document.createElement("a");
    link.href = "https://www.youtube.com/watch?v=VIDX_lookup";
    row.appendChild(link);
    expect(getChannelId(row)).toBe("UCxxxxxxxxxxxxxxxxxxxxxx");
  });
});

describe("captured snapshot canary", () => {
  it("captured fixture yields tokens via the walker", () => {
    collectTokens(captured);
    expect(tokenCount()).toBeGreaterThan(0);
  });
});
