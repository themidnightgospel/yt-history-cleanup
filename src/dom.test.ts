import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  decorateRow,
  decorateShelf,
  insertDeleteButton,
  onDeleteClick,
  onShelfDeleteClick,
  makeTrashIcon,
  showToast,
  observeNewItems,
  HISTORY_ITEM_SELECTOR,
} from "./dom.js";
import { collectTokens, clearTokens } from "./tokens.js";
import { patchFetchForContinuations } from "./fetch-patch.js";
import synthetic from "../tests/fixtures/synthetic-history.json" with { type: "json" };

function expireAllCookies(): void {
  document.cookie = "SAPISID=; expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/";
  document.cookie = "__Secure-3PAPISID=; expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure";
}

beforeEach(() => {
  document.body.innerHTML = "";
  clearTokens();
  expireAllCookies();
  window.ytcfg = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function makeHistoryRow(videoId: string): HTMLElement {
  const row = document.createElement("yt-lockup-view-model") as HTMLElement;
  const link = document.createElement("a");
  link.href = `https://www.youtube.com/watch?v=${videoId}`;
  row.appendChild(link);
  return row;
}

describe("makeTrashIcon", () => {
  it("returns an SVG element with a path child", () => {
    const svg = makeTrashIcon();
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.querySelector("path")).not.toBeNull();
  });
});

describe("decorateRow", () => {
  it("marks the row as decorated and inserts a delete button", () => {
    const row = makeHistoryRow("vid1");
    decorateRow(row);
    expect(row.dataset["ythcDecorated"]).toBe("1");
    expect(row.querySelector(".ythc-delete-btn")).not.toBeNull();
    expect(row.style.position).toBe("relative");
  });

  it("does not double-decorate", () => {
    const row = makeHistoryRow("vid1");
    decorateRow(row);
    decorateRow(row);
    expect(row.querySelectorAll(".ythc-delete-btn").length).toBe(1);
  });

  it("decorates a ytm-shorts-lockup-view-model element", () => {
    const row = document.createElement("ytm-shorts-lockup-view-model") as HTMLElement;
    const link = document.createElement("a");
    link.href = "https://www.youtube.com/shorts/shortVid1";
    row.appendChild(link);
    decorateRow(row);
    expect(row.querySelector(".ythc-delete-btn")).not.toBeNull();
  });

  it("decorates a ytm-shorts-lockup-view-model-v2 element", () => {
    const row = document.createElement("ytm-shorts-lockup-view-model-v2") as HTMLElement;
    const link = document.createElement("a");
    link.href = "https://www.youtube.com/shorts/shortVid2";
    row.appendChild(link);
    decorateRow(row);
    expect(row.querySelector(".ythc-delete-btn")).not.toBeNull();
  });

  it("decorates only the outer card when shorts tags nest", () => {
    const outer = document.createElement("ytm-shorts-lockup-view-model") as HTMLElement;
    const inner = document.createElement("ytm-shorts-lockup-view-model-v2") as HTMLElement;
    const link = document.createElement("a");
    link.href = "https://www.youtube.com/shorts/shortNested";
    inner.appendChild(link);
    outer.appendChild(inner);
    document.body.appendChild(outer);

    decorateRow(outer);
    decorateRow(inner);

    expect(outer.querySelectorAll(".ythc-delete-btn").length).toBe(1);
    expect(inner.querySelector(".ythc-delete-btn")).toBeNull();
  });
});

describe("insertDeleteButton", () => {
  it("appends a button with aria-label and click handler", () => {
    const row = makeHistoryRow("vid1");
    insertDeleteButton(row);
    const btn = row.querySelector<HTMLButtonElement>(".ythc-delete-btn")!;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute("aria-label")).toBe("Delete from history");
    expect(btn.title).toBe("Delete from history");
  });
});

describe("onDeleteClick", () => {
  it("shows a toast and does not remove the row when no token is known", async () => {
    const row = makeHistoryRow("unknownVid");
    document.body.appendChild(row);
    const event = new MouseEvent("click");
    await onDeleteClick(event, row);
    expect(document.body.contains(row)).toBe(true);
    expect(document.querySelector(".ythc-toast")?.textContent).toMatch(/Could not find token/);
  });

  it("removes the row and calls fetch when token is known", async () => {
    collectTokens(synthetic.viaHideItemSection);
    window.ytcfg = { data_: { INNERTUBE_API_KEY: "K" } };
    document.cookie = "SAPISID=abc; Path=/";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ feedbackResponses: [{ isProcessed: true }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const row = makeHistoryRow("vidHideItem");
    document.body.appendChild(row);
    const event = new MouseEvent("click");
    await onDeleteClick(event, row);

    expect(document.body.contains(row)).toBe(false);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("does not advance the parent reel shelf while siblings remain", async () => {
    collectTokens(synthetic.viaHideItemSection);
    window.ytcfg = { data_: { INNERTUBE_API_KEY: "K" } };
    document.cookie = "SAPISID=abc; Path=/";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ feedbackResponses: [{ isProcessed: true }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const shelf = document.createElement("ytd-reel-shelf-renderer");
    const arrowDiv = document.createElement("div");
    arrowDiv.id = "right-arrow";
    const arrow = document.createElement("button");
    arrow.setAttribute("aria-label", "Next");
    arrowDiv.appendChild(arrow);
    shelf.appendChild(arrowDiv);
    let arrowClicks = 0;
    arrow.addEventListener("click", () => arrowClicks++);

    const row = document.createElement("ytm-shorts-lockup-view-model") as HTMLElement;
    const link = document.createElement("a");
    link.href = "https://www.youtube.com/shorts/vidHideItem";
    row.appendChild(link);
    shelf.appendChild(row);

    const sibling = document.createElement("ytm-shorts-lockup-view-model") as HTMLElement;
    shelf.appendChild(sibling);

    document.body.appendChild(shelf);

    await onDeleteClick(new MouseEvent("click"), row);

    expect(arrowClicks).toBe(0);
  });

  it("advances the parent reel shelf when deleting the last shelf short", async () => {
    collectTokens(synthetic.viaHideItemSection);
    window.ytcfg = { data_: { INNERTUBE_API_KEY: "K" } };
    document.cookie = "SAPISID=abc; Path=/";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ feedbackResponses: [{ isProcessed: true }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const shelf = document.createElement("ytd-reel-shelf-renderer");
    const rightDiv = document.createElement("div");
    rightDiv.id = "right-arrow";
    const right = document.createElement("button");
    right.setAttribute("aria-label", "Next");
    rightDiv.appendChild(right);
    shelf.appendChild(rightDiv);
    const leftDiv = document.createElement("div");
    leftDiv.id = "left-arrow";
    const left = document.createElement("button");
    left.setAttribute("aria-label", "Previous");
    leftDiv.appendChild(left);
    shelf.appendChild(leftDiv);

    let rightClicks = 0;
    let leftClicks = 0;
    right.addEventListener("click", () => rightClicks++);
    left.addEventListener("click", () => leftClicks++);

    const row = document.createElement("ytm-shorts-lockup-view-model") as HTMLElement;
    const link = document.createElement("a");
    link.href = "https://www.youtube.com/shorts/vidHideItem";
    row.appendChild(link);
    shelf.appendChild(row);
    document.body.appendChild(shelf);

    await onDeleteClick(new MouseEvent("click"), row);

    expect(rightClicks).toBe(1);
    expect(leftClicks).toBe(1);
  });

  it("does not click a disabled right arrow", async () => {
    collectTokens(synthetic.viaHideItemSection);
    window.ytcfg = { data_: { INNERTUBE_API_KEY: "K" } };
    document.cookie = "SAPISID=abc; Path=/";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ feedbackResponses: [{ isProcessed: true }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const shelf = document.createElement("ytd-reel-shelf-renderer");
    const arrowDiv = document.createElement("div");
    arrowDiv.id = "right-arrow";
    const arrow = document.createElement("button");
    arrow.setAttribute("aria-label", "Next");
    arrow.setAttribute("aria-disabled", "true");
    arrowDiv.appendChild(arrow);
    shelf.appendChild(arrowDiv);
    let arrowClicks = 0;
    arrow.addEventListener("click", () => arrowClicks++);

    const row = document.createElement("ytm-shorts-lockup-view-model") as HTMLElement;
    const link = document.createElement("a");
    link.href = "https://www.youtube.com/shorts/vidHideItem";
    row.appendChild(link);
    shelf.appendChild(row);
    document.body.appendChild(shelf);

    await onDeleteClick(new MouseEvent("click"), row);

    expect(arrowClicks).toBe(0);
  });

  it("shows a failure toast when delete API rejects", async () => {
    collectTokens(synthetic.viaHideItemSection);
    window.ytcfg = { data_: { INNERTUBE_API_KEY: "K" } };
    document.cookie = "SAPISID=abc; Path=/";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("oops", { status: 500 }),
    );

    const row = makeHistoryRow("vidHideItem");
    document.body.appendChild(row);
    await onDeleteClick(new MouseEvent("click"), row);

    expect(document.querySelector(".ythc-toast")?.textContent).toMatch(/Failed to delete/);
  });
});

function makeShelf(
  withMenu = true,
  rightArrowDisabled = false,
): { shelf: HTMLElement; right: HTMLButtonElement; menu: HTMLElement | null } {
  const shelf = document.createElement("ytd-reel-shelf-renderer") as HTMLElement;
  const header = document.createElement("div");
  header.id = "header";
  let menu: HTMLElement | null = null;
  if (withMenu) {
    menu = document.createElement("div");
    menu.id = "menu";
    const moreBtn = document.createElement("button");
    moreBtn.setAttribute("aria-label", "More actions");
    menu.appendChild(moreBtn);
    header.appendChild(menu);
  }
  shelf.appendChild(header);

  const rightDiv = document.createElement("div");
  rightDiv.id = "right-arrow";
  const right = document.createElement("button");
  right.setAttribute("aria-label", "Next");
  if (rightArrowDisabled) right.setAttribute("aria-disabled", "true");
  rightDiv.appendChild(right);
  shelf.appendChild(rightDiv);

  return { shelf, right, menu };
}

function makeShortCard(videoId: string): HTMLElement {
  const card = document.createElement("ytm-shorts-lockup-view-model") as HTMLElement;
  const link = document.createElement("a");
  link.href = `https://www.youtube.com/shorts/${videoId}`;
  card.appendChild(link);
  return card;
}

describe("decorateShelf", () => {
  it("inserts a delete-all button immediately before #menu", () => {
    const { shelf, menu } = makeShelf();
    shelf.appendChild(makeShortCard("vid"));
    document.body.appendChild(shelf);
    decorateShelf(shelf);
    const btn = shelf.querySelector(".ythc-shelf-delete-btn");
    expect(btn).not.toBeNull();
    expect(btn?.nextElementSibling).toBe(menu);
  });

  it("is idempotent", () => {
    const { shelf } = makeShelf();
    shelf.appendChild(makeShortCard("vid"));
    document.body.appendChild(shelf);
    decorateShelf(shelf);
    decorateShelf(shelf);
    expect(shelf.querySelectorAll(".ythc-shelf-delete-btn").length).toBe(1);
  });

  it("does nothing when the shelf has no #header > #menu", () => {
    const { shelf } = makeShelf(false);
    shelf.appendChild(makeShortCard("vid"));
    document.body.appendChild(shelf);
    decorateShelf(shelf);
    expect(shelf.querySelector(".ythc-shelf-delete-btn")).toBeNull();
    expect(shelf.dataset["ythcShelfDecorated"]).toBeUndefined();
  });

  it("does nothing when the shelf contains no shorts lockups", () => {
    const { shelf } = makeShelf();
    document.body.appendChild(shelf);
    decorateShelf(shelf);
    expect(shelf.querySelector(".ythc-shelf-delete-btn")).toBeNull();
    expect(shelf.dataset["ythcShelfDecorated"]).toBeUndefined();
  });

  it("decorates a previously-empty shelf when a shorts card arrives via observer", async () => {
    observeNewItems();
    const { shelf } = makeShelf();
    document.body.appendChild(shelf);
    await new Promise((r) => setTimeout(r, 0));
    expect(shelf.querySelector(".ythc-shelf-delete-btn")).toBeNull();

    shelf.appendChild(makeShortCard("vidLate"));
    await new Promise((r) => setTimeout(r, 0));
    expect(shelf.querySelector(".ythc-shelf-delete-btn")).not.toBeNull();
  });
});

describe("onShelfDeleteClick", () => {
  function primeAuth(): void {
    window.ytcfg = { data_: { INNERTUBE_API_KEY: "K" } };
    document.cookie = "SAPISID=abc; Path=/";
  }

  it("deletes all-but-one when arrow enabled, then advances", async () => {
    primeAuth();
    for (let i = 1; i <= 6; i++) {
      collectTokens({
        feedbackToken: `TOK_${i}`,
        actions: [{ hideItemSectionVideosByIdCommand: { videoId: `shortVid_${i}` } }],
      });
    }
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ feedbackResponses: [{ isProcessed: true }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Register token for the late card YT will return in the continuation.
    collectTokens({
      feedbackToken: "TOK_LATE_1",
      actions: [{ hideItemSectionVideosByIdCommand: { videoId: "shortVid_late_1" } }],
    });

    const { shelf, right } = makeShelf();
    for (let i = 1; i <= 6; i++) shelf.appendChild(makeShortCard(`shortVid_${i}`));

    let rightClicks = 0;
    right.addEventListener("click", () => {
      rightClicks++;
      // Simulate YT's async continuation: append a new card after the click
      // returns so waitForNewCards observes a real growth.
      setTimeout(() => {
        shelf.appendChild(makeShortCard(`shortVid_late_${rightClicks}`));
      }, 0);
      if (rightClicks >= 1) right.setAttribute("aria-disabled", "true");
    });

    document.body.appendChild(shelf);

    await onShelfDeleteClick(new MouseEvent("click"), shelf);

    // After the loop: the original "kept last" card and the appended late
    // card should all be gone since the final round (arrow disabled) deletes
    // everything remaining.
    expect(shelf.querySelectorAll("ytm-shorts-lockup-view-model").length).toBe(0);
    expect(rightClicks).toBe(1);
  });

  it("deletes everything on the final page (arrow disabled)", async () => {
    primeAuth();
    for (let i = 1; i <= 3; i++) {
      collectTokens({
        feedbackToken: `TOK_F_${i}`,
        actions: [{ hideItemSectionVideosByIdCommand: { videoId: `vidF_${i}` } }],
      });
    }
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ feedbackResponses: [{ isProcessed: true }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { shelf } = makeShelf(true, true);
    for (let i = 1; i <= 3; i++) shelf.appendChild(makeShortCard(`vidF_${i}`));
    document.body.appendChild(shelf);

    await onShelfDeleteClick(new MouseEvent("click"), shelf);

    expect(shelf.querySelectorAll("ytm-shorts-lockup-view-model").length).toBe(0);
  });

  it("force-deletes the stranded kept card when waitForNewCards times out", async () => {
    primeAuth();
    for (let i = 1; i <= 6; i++) {
      collectTokens({
        feedbackToken: `TOK_X_${i}`,
        actions: [{ hideItemSectionVideosByIdCommand: { videoId: `vidX_${i}` } }],
      });
    }
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ feedbackResponses: [{ isProcessed: true }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { shelf, right } = makeShelf();
    for (let i = 1; i <= 6; i++) shelf.appendChild(makeShortCard(`vidX_${i}`));

    // Click handler claims it'll load more (no aria-disabled) but never
    // appends anything — exercise the timeout path.
    right.addEventListener("click", () => {});

    document.body.appendChild(shelf);

    await onShelfDeleteClick(new MouseEvent("click"), shelf);

    expect(shelf.querySelectorAll("ytm-shorts-lockup-view-model").length).toBe(0);
  }, 10000);

  it("shows a summary toast when some deletes fail", async () => {
    primeAuth();
    // Token registered for vidS_1 only — vidS_2 will fail with "no token".
    collectTokens({
      feedbackToken: "TOK_S_1",
      actions: [{ hideItemSectionVideosByIdCommand: { videoId: "vidS_1" } }],
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ feedbackResponses: [{ isProcessed: true }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { shelf } = makeShelf(true, true);
    shelf.appendChild(makeShortCard("vidS_1"));
    shelf.appendChild(makeShortCard("vidS_2"));
    document.body.appendChild(shelf);

    await onShelfDeleteClick(new MouseEvent("click"), shelf);

    expect(document.querySelector(".ythc-toast")?.textContent).toMatch(
      /Deleted 1\. Failed 1\./,
    );
  });
});

describe("showToast", () => {
  it("renders a toast and removes it after lifetime", () => {
    vi.useFakeTimers();
    showToast("hi");
    expect(document.querySelector(".ythc-toast")?.textContent).toBe("hi");
    vi.advanceTimersByTime(5000);
    expect(document.querySelector(".ythc-toast")).toBeNull();
  });
});

describe("observeNewItems", () => {
  it("decorates rows appended after observer attaches", async () => {
    observeNewItems();
    const row = makeHistoryRow("vidNew");
    document.body.appendChild(row);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(row.dataset["ythcDecorated"]).toBe("1");
  });
});

describe("patchFetchForContinuations", () => {
  it("scans /youtubei/v1/browse responses and registers tokens", async () => {
    const original = window.fetch;
    const continuationPayload = {
      feedbackToken: "TOK_CONT",
      actions: [{ hideItemSectionVideosByIdCommand: { videoId: "vidContinuation" } }],
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify(continuationPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    patchFetchForContinuations();
    await window.fetch("https://www.youtube.com/youtubei/v1/browse");
    await new Promise((r) => setTimeout(r, 0));

    const row = makeHistoryRow("vidContinuation");
    const { getFeedbackToken } = await import("./tokens.js");
    expect(getFeedbackToken(row)).toBe("TOK_CONT");

    window.fetch = original;
  });

  it("ignores fetches that don't hit the browse endpoint", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    patchFetchForContinuations();
    await window.fetch("https://example.com/something");

    expect(HISTORY_ITEM_SELECTOR).toContain("yt-lockup-view-model");
  });
});
