import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  decorateRow,
  insertDeleteButton,
  onDeleteClick,
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
