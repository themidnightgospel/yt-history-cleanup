import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  tryDecorateChannelButton,
  openChannelDeleteDialog,
  extractChannelDisplayName,
  resetChannelDeleteState,
  isChannelDeleteInProgress,
} from "./channel-delete.js";
import { collectTokens, collectChannels, clearTokens } from "./tokens.js";

function expireAuthCookies(): void {
  document.cookie = "SAPISID=; expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/";
  document.cookie = "__Secure-3PAPISID=; expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure";
}

beforeEach(() => {
  document.body.innerHTML = "";
  clearTokens();
  resetChannelDeleteState();
  expireAuthCookies();
  window.ytcfg = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function makeVideoRow(videoId: string, channelName = "Cool Channel"): HTMLElement {
  const row = document.createElement("yt-lockup-view-model") as HTMLElement;

  const link = document.createElement("a");
  link.href = `https://www.youtube.com/watch?v=${videoId}`;
  row.appendChild(link);

  const avatar = document.createElement("div");
  avatar.setAttribute("aria-label", `Go to channel ${channelName}`);
  row.appendChild(avatar);

  const metadataRow = document.createElement("div");
  metadataRow.className = "ytContentMetadataViewModelMetadataRow";
  const channelSpan = document.createElement("span");
  channelSpan.textContent = channelName;
  metadataRow.appendChild(channelSpan);
  const delim = document.createElement("span");
  delim.textContent = " • ";
  metadataRow.appendChild(delim);
  const viewsSpan = document.createElement("span");
  viewsSpan.textContent = "50K views";
  metadataRow.appendChild(viewsSpan);
  row.appendChild(metadataRow);

  return row;
}

function makeShortRow(videoId: string): HTMLElement {
  const row = document.createElement("ytd-video-renderer") as HTMLElement;
  const link = document.createElement("a");
  link.href = `https://www.youtube.com/shorts/${videoId}`;
  row.appendChild(link);
  const metadataRow = document.createElement("div");
  metadataRow.className = "ytContentMetadataViewModelMetadataRow";
  row.appendChild(metadataRow);
  return row;
}

describe("tryDecorateChannelButton", () => {
  it("inserts a channel-delete button on a video row", () => {
    const row = makeVideoRow("vidA");
    document.body.appendChild(row);
    tryDecorateChannelButton(row);
    expect(row.querySelector(".ythc-channel-delete-btn")).not.toBeNull();
  });

  it("does not insert on a shorts row", () => {
    const row = makeShortRow("shortA");
    document.body.appendChild(row);
    tryDecorateChannelButton(row);
    expect(row.querySelector(".ythc-channel-delete-btn")).toBeNull();
  });

  it("does nothing when the row has no metadata row", () => {
    const row = document.createElement("yt-lockup-view-model") as HTMLElement;
    const link = document.createElement("a");
    link.href = "https://www.youtube.com/watch?v=vidNoMeta";
    row.appendChild(link);
    document.body.appendChild(row);
    tryDecorateChannelButton(row);
    expect(row.querySelector(".ythc-channel-delete-btn")).toBeNull();
  });

  it("is idempotent", () => {
    const row = makeVideoRow("vidB");
    document.body.appendChild(row);
    tryDecorateChannelButton(row);
    tryDecorateChannelButton(row);
    expect(row.querySelectorAll(".ythc-channel-delete-btn").length).toBe(1);
  });
});

describe("extractChannelDisplayName", () => {
  it("reads from the avatar aria-label first", () => {
    const row = makeVideoRow("vidC", "Veritasium");
    document.body.appendChild(row);
    expect(extractChannelDisplayName(row)).toBe("Veritasium");
  });

  it("falls back to the byline span when no avatar label", () => {
    const row = document.createElement("yt-lockup-view-model") as HTMLElement;
    const link = document.createElement("a");
    link.href = "https://www.youtube.com/watch?v=vidD";
    row.appendChild(link);
    const meta = document.createElement("div");
    meta.className = "ytContentMetadataViewModelMetadataRow";
    const span = document.createElement("span");
    span.textContent = "Fallback Channel";
    meta.appendChild(span);
    row.appendChild(meta);
    document.body.appendChild(row);
    expect(extractChannelDisplayName(row)).toBe("Fallback Channel");
  });

  it("returns null when nothing is parseable", () => {
    const row = document.createElement("yt-lockup-view-model") as HTMLElement;
    document.body.appendChild(row);
    expect(extractChannelDisplayName(row)).toBeNull();
  });
});

describe("openChannelDeleteDialog", () => {
  it("renders title with channel name and a days dropdown", () => {
    const dialog = openChannelDeleteDialog("UCfoo", "My Channel");
    expect(dialog.querySelector(".ythc-channel-dialog-title")?.textContent).toContain(
      "My Channel",
    );
    const opts = dialog.querySelectorAll<HTMLOptionElement>(".ythc-channel-dialog-select option");
    expect(opts.length).toBe(6);
    expect(opts[0]!.textContent).toBe("Today");
    expect(opts[opts.length - 1]!.textContent).toBe("All time");
    dialog.remove();
  });

  it("cancel button closes and removes the dialog", () => {
    const dialog = openChannelDeleteDialog("UCfoo", "My Channel");
    const cancelBtn = dialog.querySelector<HTMLButtonElement>(
      ".ythc-channel-dialog-form .ythc-channel-dialog-btn:not(.ythc-channel-dialog-btn-danger)",
    )!;
    cancelBtn.click();
    expect(dialog.isConnected).toBe(false);
  });

  it("confirm swaps form to progress UI and triggers the run", { timeout: 10000 }, async () => {
    // Set up so the run completes quickly with no work.
    window.ytcfg = { data_: { INNERTUBE_API_KEY: "K" } };
    document.cookie = "SAPISID=abc; Path=/";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ feedbackResponses: [{ isProcessed: true }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const dialog = openChannelDeleteDialog("UCemptyChannel", "Empty Channel");
    const confirmBtn = dialog.querySelector<HTMLButtonElement>(
      ".ythc-channel-dialog-btn-danger",
    )!;
    confirmBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    const progress = dialog.querySelector<HTMLElement>(".ythc-channel-dialog-progress")!;
    expect(progress.hidden).toBe(false);
    const counter = dialog.querySelector(".ythc-channel-dialog-counter");
    expect(counter?.textContent).toBeTruthy();
    expect(isChannelDeleteInProgress()).toBe(true);

    // Loop hits the scroll-wait timeout (~4 s) since the fixture has no
    // sections. Wait long enough for that to drain.
    await new Promise((r) => setTimeout(r, 5000));
    expect(isChannelDeleteInProgress()).toBe(false);
    dialog.remove();
  });
});
