import { describe, it, expect, beforeEach } from "vitest";
import {
  collectTokens,
  videoIdFromFeedbackActions,
  getFeedbackToken,
  getVideoId,
  buildInitialTokenMap,
  clearTokens,
  tokenCount,
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

describe("captured snapshot canary", () => {
  it("captured fixture contains at least one extractable token (or is the placeholder)", () => {
    if ("_PLACEHOLDER" in captured) {
      // No real snapshot supplied yet — skip the canary assertion but document why.
      expect(captured._PLACEHOLDER).toBeTypeOf("string");
      return;
    }
    collectTokens(captured);
    expect(tokenCount()).toBeGreaterThan(0);
  });
});
