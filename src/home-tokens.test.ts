import { describe, it, expect, beforeEach } from "vitest";
import {
  collectHomeTokens,
  buildInitialHomeTokenMap,
  labeledTokensIn,
  findLabeledToken,
  getHomeToken,
  getHomeVideoId,
  clearHomeTokens,
  homeTokenCount,
  UNDO_LABEL,
} from "./home-tokens.js";
import synthetic from "../tests/fixtures/synthetic-home.json" with { type: "json" };

beforeEach(() => clearHomeTokens());

function makeCard(href: string): HTMLElement {
  const card = document.createElement("ytd-rich-item-renderer") as HTMLElement;
  const link = document.createElement("a");
  link.href = href;
  card.appendChild(link);
  return card;
}

describe("collectHomeTokens", () => {
  it("keys both actions of a lockup card by its contentId", () => {
    collectHomeTokens(synthetic.lockupCard);
    expect(homeTokenCount()).toBe(1);
    const card = makeCard("https://www.youtube.com/watch?v=vidLockup01");
    expect(getHomeToken(card, "notInterested")).toBe("TOKEN_LOCKUP_NI");
    expect(getHomeToken(card, "dontRecommendChannel")).toBe("TOKEN_LOCKUP_DRC");
  });

  it("keys both actions of a classic videoRenderer by its videoId", () => {
    collectHomeTokens(synthetic.classicCard);
    const card = makeCard("https://www.youtube.com/watch?v=vidClassic1");
    expect(getHomeToken(card, "notInterested")).toBe("TOKEN_CLASSIC_NI");
    expect(getHomeToken(card, "dontRecommendChannel")).toBe("TOKEN_CLASSIC_DRC");
  });

  it("registers only Not interested for a short with no channel action", () => {
    collectHomeTokens(synthetic.shortsCard);
    const card = makeCard("https://www.youtube.com/shorts/vidShorts01");
    expect(getHomeToken(card, "notInterested")).toBe("TOKEN_SHORTS_NI");
    expect(getHomeToken(card, "dontRecommendChannel")).toBeNull();
  });

  it("ignores a mix card whose menu carries no feedback tokens", () => {
    collectHomeTokens(synthetic.mixCard);
    expect(homeTokenCount()).toBe(0);
  });

  it("does not treat a bare endpoint with a videoId as a card", () => {
    collectHomeTokens(synthetic.endpointWithVideoIdButNoMenu);
    expect(homeTokenCount()).toBe(0);
  });

  it("merges per action so a later payload refreshes one token and keeps the other", () => {
    collectHomeTokens(synthetic.lockupCard);
    collectHomeTokens({
      lockupViewModel: {
        contentId: "vidLockup01",
        x: {
          title: { content: "Not interested" },
          feedbackEndpoint: { feedbackToken: "TOKEN_SECOND" },
        },
      },
    });
    const card = makeCard("https://www.youtube.com/watch?v=vidLockup01");
    expect(getHomeToken(card, "notInterested")).toBe("TOKEN_SECOND");
    expect(getHomeToken(card, "dontRecommendChannel")).toBe("TOKEN_LOCKUP_DRC");
  });

  it("keys a short by the reelWatchEndpoint videoId under its tap command", () => {
    collectHomeTokens(synthetic.shortsCard);
    expect(homeTokenCount()).toBe(1);
    expect(getHomeToken(makeCard("/shorts/vidShorts01"), "notInterested")).toBe(
      "TOKEN_SHORTS_NI",
    );
  });

  it("walks a whole feed payload with several cards", () => {
    collectHomeTokens({
      contents: [synthetic.lockupCard, synthetic.classicCard, synthetic.shortsCard],
    });
    expect(homeTokenCount()).toBe(3);
  });

  it("is null-safe on garbage input", () => {
    expect(() => collectHomeTokens(null)).not.toThrow();
    expect(() => collectHomeTokens(undefined)).not.toThrow();
    expect(() => collectHomeTokens(42)).not.toThrow();
    expect(() => collectHomeTokens("string")).not.toThrow();
  });
});

describe("labeledTokensIn", () => {
  it("pairs each token with the closest enclosing label", () => {
    const found = labeledTokensIn(synthetic.lockupCard);
    expect(found).toEqual([
      expect.objectContaining({ label: "Not interested", token: "TOKEN_LOCKUP_NI" }),
      expect.objectContaining({ label: "Don’t recommend channel", token: "TOKEN_LOCKUP_DRC" }),
    ]);
  });

  it("reads simpleText and runs labels", () => {
    const labels = labeledTokensIn(synthetic.classicCard).map((t) => t.label);
    expect(labels).toEqual(["Not interested", "Don't recommend channel"]);
  });

  it("reads a plain-string title, as view-model buttons use", () => {
    const found = labeledTokensIn({
      buttonViewModel: {
        title: "Undo",
        onTap: { innertubeCommand: { feedbackEndpoint: { feedbackToken: "T_VM_UNDO" } } },
      },
    });
    expect(found).toEqual([{ label: "Undo", token: "T_VM_UNDO" }]);
  });

  it("survives cyclic input", () => {
    const a: Record<string, unknown> = { feedbackEndpoint: { feedbackToken: "T" } };
    a["self"] = a;
    expect(labeledTokensIn(a)).toHaveLength(1);
  });
});

describe("findLabeledToken", () => {
  it("returns the Undo token from a feedback response, not the survey one", () => {
    const token = findLabeledToken(synthetic.feedbackResponseWithUndo.actions, UNDO_LABEL);
    expect(token).toBe("TOKEN_UNDO");
  });

  it("returns null when no label matches", () => {
    expect(findLabeledToken(synthetic.feedbackResponseWithoutUndo.actions, UNDO_LABEL)).toBeNull();
  });
});

describe("getHomeVideoId", () => {
  it("reads the video id from a plain watch link", () => {
    expect(getHomeVideoId(makeCard("https://www.youtube.com/watch?v=vidLockup01"))).toBe(
      "vidLockup01",
    );
  });

  it("ignores playlist and mix links so a list card never borrows a video's tokens", () => {
    const card = makeCard("https://www.youtube.com/watch?v=vidLockup01&list=RDvidLockup01");
    expect(getHomeVideoId(card)).toBeNull();
  });

  it("prefers a plain link over a list link when both are present", () => {
    const card = makeCard("https://www.youtube.com/watch?v=vidLockup01&list=PL1");
    const plain = document.createElement("a");
    plain.href = "https://www.youtube.com/watch?v=vidClassic1";
    card.appendChild(plain);
    expect(getHomeVideoId(card)).toBe("vidClassic1");
  });
});

describe("getHomeToken", () => {
  it("returns null when the card has no video link", () => {
    collectHomeTokens(synthetic.lockupCard);
    const card = document.createElement("ytd-rich-item-renderer") as HTMLElement;
    expect(getHomeToken(card, "notInterested")).toBeNull();
  });

  it("returns null for an unknown video", () => {
    const card = makeCard("https://www.youtube.com/watch?v=unknownVid1");
    expect(getHomeToken(card, "notInterested")).toBeNull();
  });
});

describe("buildInitialHomeTokenMap", () => {
  it("does nothing when window.ytInitialData is absent", () => {
    window.ytInitialData = undefined;
    buildInitialHomeTokenMap();
    expect(homeTokenCount()).toBe(0);
  });

  it("walks window.ytInitialData when present", () => {
    window.ytInitialData = synthetic.lockupCard;
    buildInitialHomeTokenMap();
    expect(homeTokenCount()).toBe(1);
  });
});
