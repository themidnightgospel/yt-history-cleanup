import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  decorateHomeCard,
  decorateAllHomeCards,
  onFeedbackClick,
  showRemovedPlaceholder,
  restoreAllPlaceholders,
  HOME_CARD_SELECTOR,
} from "./home-feed.js";
import { collectHomeTokens, clearHomeTokens } from "./home-tokens.js";
import synthetic from "../tests/fixtures/synthetic-home.json" with { type: "json" };

function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${value}; Path=/`;
}

function expireCookies(): void {
  document.cookie = "SAPISID=; expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/";
}

function arm(): void {
  window.ytcfg = { data_: { INNERTUBE_API_KEY: "KEY" } };
  setCookie("SAPISID", "abc");
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeCard(href: string, withThumb = true): HTMLElement {
  const card = document.createElement("ytd-rich-item-renderer") as HTMLElement;
  const content = document.createElement("div");
  content.id = "content";
  const lockup = document.createElement("yt-lockup-view-model");
  const link = document.createElement("a");
  link.href = href;
  lockup.appendChild(link);
  if (withThumb) lockup.appendChild(document.createElement("yt-thumbnail-view-model"));
  content.appendChild(lockup);
  card.appendChild(content);
  document.body.appendChild(card);
  return card;
}

function buttons(card: HTMLElement): string[] {
  return Array.from(card.querySelectorAll<HTMLElement>(".ythc-fb-btn")).map(
    (b) => b.dataset["action"]!,
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
  clearHomeTokens();
  expireCookies();
  window.ytcfg = undefined;
  restoreAllPlaceholders();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("decorateHomeCard", () => {
  it("adds one button per known action, stacked in a box on the thumbnail", () => {
    collectHomeTokens(synthetic.lockupCard);
    const card = makeCard("https://www.youtube.com/watch?v=vidLockup01");
    decorateHomeCard(card);
    expect(buttons(card)).toEqual(["notInterested", "dontRecommendChannel"]);
    const host = card.querySelector<HTMLElement>("yt-thumbnail-view-model")!;
    expect(host.style.position).toBe("relative");
    expect(host.querySelector(".ythc-fb-box")).not.toBeNull();
  });

  it("adds only Not interested for a short", () => {
    collectHomeTokens(synthetic.shortsCard);
    const card = makeCard("https://www.youtube.com/shorts/vidShorts01");
    decorateHomeCard(card);
    expect(buttons(card)).toEqual(["notInterested"]);
  });

  it("adds nothing when no token is known, then fills in once tokens arrive", () => {
    const card = makeCard("https://www.youtube.com/watch?v=vidLockup01");
    decorateHomeCard(card);
    expect(buttons(card)).toEqual([]);
    collectHomeTokens(synthetic.lockupCard);
    decorateHomeCard(card);
    expect(buttons(card)).toEqual(["notInterested", "dontRecommendChannel"]);
  });

  it("does not double-decorate", () => {
    collectHomeTokens(synthetic.lockupCard);
    const card = makeCard("https://www.youtube.com/watch?v=vidLockup01");
    decorateHomeCard(card);
    decorateHomeCard(card);
    expect(buttons(card)).toHaveLength(2);
    expect(card.querySelectorAll(".ythc-fb-box")).toHaveLength(1);
  });

  it("skips cards without a video link or a thumbnail host", () => {
    collectHomeTokens(synthetic.lockupCard);
    const noThumb = makeCard("https://www.youtube.com/watch?v=vidLockup01", false);
    decorateHomeCard(noThumb);
    expect(buttons(noThumb)).toEqual([]);

    const noLink = document.createElement("ytd-rich-item-renderer") as HTMLElement;
    document.body.appendChild(noLink);
    decorateHomeCard(noLink);
    expect(noLink.querySelector(".ythc-fb-box")).toBeNull();
  });

  it("rebuilds the box when the element is re-bound to another video", () => {
    collectHomeTokens({ a: synthetic.lockupCard, b: synthetic.shortsCard });
    const card = makeCard("https://www.youtube.com/watch?v=vidLockup01");
    decorateHomeCard(card);
    expect(buttons(card)).toHaveLength(2);

    card.querySelector("a")!.href = "https://www.youtube.com/shorts/vidShorts01";
    decorateHomeCard(card);
    expect(buttons(card)).toEqual(["notInterested"]);
    expect(card.querySelectorAll(".ythc-fb-box")).toHaveLength(1);
  });

  it("decorateAllHomeCards sweeps every card in the document", () => {
    collectHomeTokens({ a: synthetic.lockupCard, b: synthetic.classicCard });
    makeCard("https://www.youtube.com/watch?v=vidLockup01");
    makeCard("https://www.youtube.com/watch?v=vidClassic1");
    decorateAllHomeCards();
    expect(document.querySelectorAll(HOME_CARD_SELECTOR)).toHaveLength(2);
    expect(document.querySelectorAll(".ythc-fb-btn")).toHaveLength(4);
  });
});

describe("showRemovedPlaceholder", () => {
  it("hides the card content and shows the message with an Undo button", () => {
    const card = makeCard("https://www.youtube.com/watch?v=vidLockup01");
    const lockup = card.querySelector<HTMLElement>("yt-lockup-view-model")!;
    const p = showRemovedPlaceholder(card, "vidLockup01", "Video removed");
    expect(lockup.style.display).toBe("none");
    const box = card.querySelector<HTMLElement>("#content > .ythc-removed")!;
    expect(box.querySelector(".ythc-removed-msg")?.textContent).toBe("Video removed");
    expect(box.querySelector(".ythc-removed-undo")?.textContent).toBe("Undo");

    p.restore();
    expect(card.querySelector(".ythc-removed")).toBeNull();
    expect(lockup.style.display).toBe("");
  });

  it("restoreAllPlaceholders clears every live placeholder", () => {
    const a = makeCard("https://www.youtube.com/watch?v=vidLockup01");
    const b = makeCard("https://www.youtube.com/watch?v=vidClassic1");
    showRemovedPlaceholder(a, "vidLockup01", "x");
    showRemovedPlaceholder(b, "vidClassic1", "y");
    restoreAllPlaceholders();
    expect(document.querySelectorAll(".ythc-removed")).toHaveLength(0);
  });

  it("decorateHomeCard drops a placeholder when the card is re-bound and rebuilds the box", () => {
    collectHomeTokens({ a: synthetic.lockupCard, b: synthetic.classicCard });
    const card = makeCard("https://www.youtube.com/watch?v=vidLockup01");
    decorateHomeCard(card);
    showRemovedPlaceholder(card, "vidLockup01", "x");
    card.querySelector("a")!.href = "https://www.youtube.com/watch?v=vidClassic1";
    decorateHomeCard(card);
    expect(card.querySelector(".ythc-removed")).toBeNull();
    const box = card.querySelector<HTMLElement>(".ythc-fb-box")!;
    expect(box.dataset["videoId"]).toBe("vidClassic1");
  });

  it("showRemovedPlaceholder prunes placeholders of cards no longer in the document", () => {
    const gone = makeCard("https://www.youtube.com/watch?v=vidLockup01");
    showRemovedPlaceholder(gone, "vidLockup01", "x");
    gone.remove();
    const card = makeCard("https://www.youtube.com/watch?v=vidClassic1");
    showRemovedPlaceholder(card, "vidClassic1", "y");
    restoreAllPlaceholders();
    // Only the live card's placeholder existed to restore; the detached one
    // was already pruned and must not resurrect anything.
    expect(gone.querySelector(".ythc-removed")).toBeNull();
    expect(card.querySelector(".ythc-removed")).toBeNull();
  });
});

describe("onFeedbackClick", () => {
  it("shows a toast and no placeholder when the token is unknown", async () => {
    const card = makeCard("https://www.youtube.com/watch?v=unknownVid1");
    await onFeedbackClick(new MouseEvent("click"), card, "notInterested");
    expect(card.querySelector(".ythc-removed")).toBeNull();
    expect(document.querySelector(".ythc-toast")?.textContent).toMatch(/Could not find token/);
  });

  it("posts the action token and shows the placeholder", async () => {
    arm();
    collectHomeTokens(synthetic.lockupCard);
    const card = makeCard("https://www.youtube.com/watch?v=vidLockup01");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonRes(synthetic.feedbackResponseWithUndo));

    await onFeedbackClick(new MouseEvent("click"), card, "dontRecommendChannel");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body.feedbackTokens).toEqual(["TOKEN_LOCKUP_DRC"]);
    expect(card.querySelector(".ythc-removed-msg")?.textContent).toMatch(/won't recommend/);
    expect(document.querySelector(".ythc-toast")).toBeNull();
  });

  it("Undo restores the card and posts the Undo token, not the survey token", async () => {
    arm();
    collectHomeTokens(synthetic.lockupCard);
    const card = makeCard("https://www.youtube.com/watch?v=vidLockup01");
    // A fresh Response per call: a body can only be read once.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonRes(synthetic.feedbackResponseWithUndo));
    const warn = vi.spyOn(console, "warn");

    await onFeedbackClick(new MouseEvent("click"), card, "notInterested");
    card.querySelector<HTMLButtonElement>(".ythc-removed-undo")!.click();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    expect(card.querySelector(".ythc-removed")).toBeNull();
    const body = JSON.parse(fetchSpy.mock.calls[1]![1]?.body as string);
    expect(body.feedbackTokens).toEqual(["TOKEN_UNDO"]);
    // The undo request itself must succeed: no toast, no failure log.
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector(".ythc-toast")).toBeNull();
    expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(/undo failed/), expect.anything());
  });

  it("removes the Undo button when the response carries no undo token", async () => {
    arm();
    collectHomeTokens(synthetic.lockupCard);
    const card = makeCard("https://www.youtube.com/watch?v=vidLockup01");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      jsonRes(synthetic.feedbackResponseWithoutUndo),
    );

    await onFeedbackClick(new MouseEvent("click"), card, "notInterested");

    expect(card.querySelector(".ythc-removed")).not.toBeNull();
    expect(card.querySelector(".ythc-removed-undo")).toBeNull();
  });

  it("does not decorate a playlist card that links to a known video", () => {
    collectHomeTokens(synthetic.lockupCard);
    const card = makeCard("https://www.youtube.com/watch?v=vidLockup01&list=PLxyz");
    decorateHomeCard(card);
    expect(buttons(card)).toEqual([]);
  });

  it("Undo clicked while the request is in flight is sent once it lands", async () => {
    arm();
    collectHomeTokens(synthetic.lockupCard);
    const card = makeCard("https://www.youtube.com/watch?v=vidLockup01");
    let release!: (r: Response) => void;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementationOnce(
      () => new Promise<Response>((resolve) => (release = resolve)),
    );
    fetchSpy.mockResolvedValue(jsonRes(synthetic.feedbackResponseWithUndo));

    const pending = onFeedbackClick(new MouseEvent("click"), card, "notInterested");
    // The signed request is issued after an async hash step; wait for it.
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    card.querySelector<HTMLButtonElement>(".ythc-removed-undo")!.click();
    expect(card.querySelector(".ythc-removed")).toBeNull();

    release(jsonRes(synthetic.feedbackResponseWithUndo));
    await pending;
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    const body = JSON.parse(fetchSpy.mock.calls[1]![1]?.body as string);
    expect(body.feedbackTokens).toEqual(["TOKEN_UNDO"]);
  });

  it("warns via toast when Undo is requested but the response had no undo token", async () => {
    arm();
    collectHomeTokens(synthetic.lockupCard);
    const card = makeCard("https://www.youtube.com/watch?v=vidLockup01");
    let release!: (r: Response) => void;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementationOnce(
      () => new Promise<Response>((resolve) => (release = resolve)),
    );

    const pending = onFeedbackClick(new MouseEvent("click"), card, "notInterested");
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    card.querySelector<HTMLButtonElement>(".ythc-removed-undo")!.click();
    release(jsonRes(synthetic.feedbackResponseWithoutUndo));
    await pending;

    expect(document.querySelector(".ythc-toast")?.textContent).toMatch(/Couldn't undo/);
  });

  it("restores the card and shows a toast when the request fails", async () => {
    arm();
    collectHomeTokens(synthetic.lockupCard);
    const card = makeCard("https://www.youtube.com/watch?v=vidLockup01");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonRes({}, 403));

    await onFeedbackClick(new MouseEvent("click"), card, "notInterested");

    expect(card.querySelector(".ythc-removed")).toBeNull();
    expect(card.querySelector<HTMLElement>("yt-lockup-view-model")!.style.display).toBe("");
    expect(document.querySelector(".ythc-toast")?.textContent).toMatch(/Failed to send feedback/);
  });

  it("stops propagation so the card link does not navigate", async () => {
    const card = makeCard("https://www.youtube.com/watch?v=unknownVid1");
    const e = new MouseEvent("click", { bubbles: true, cancelable: true });
    await onFeedbackClick(e, card, "notInterested");
    expect(e.defaultPrevented).toBe(true);
  });
});
