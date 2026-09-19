import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ensureSpeedButtons,
  initSpeedButtons,
  currentRate,
  setRate,
  SPEEDS,
  GROUP_CLASS,
  BUTTON_CLASS,
  ACTIVE_CLASS,
} from "./speed.js";

type FakePlayer = HTMLElement & {
  setPlaybackRate: (r: number) => void;
  getPlaybackRate: () => number;
};

function makePlayer(opts: { api?: boolean; anchor?: "cc" | "gear" | "none" } = {}): {
  player: FakePlayer;
  video: HTMLVideoElement;
  controls: HTMLElement;
} {
  const { api = true, anchor = "cc" } = opts;
  const player = document.createElement("div") as unknown as FakePlayer;
  player.id = "movie_player";
  const video = document.createElement("video");
  video.className = "html5-main-video";
  player.appendChild(video);

  const controls = document.createElement("div");
  controls.className = "ytp-right-controls";
  if (anchor !== "none") {
    if (anchor === "cc") {
      const cc = document.createElement("button");
      cc.className = "ytp-button ytp-subtitles-button";
      controls.appendChild(cc);
    }
    const gear = document.createElement("button");
    gear.className = "ytp-button ytp-settings-button";
    controls.appendChild(gear);
  }
  player.appendChild(controls);

  if (api) {
    let rate = 1;
    player.setPlaybackRate = vi.fn((r: number) => {
      rate = r;
      video.playbackRate = r;
      video.dispatchEvent(new Event("ratechange"));
    });
    player.getPlaybackRate = vi.fn(() => rate);
  }
  document.body.appendChild(player);
  return { player, video, controls };
}

function buttons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(`.${BUTTON_CLASS}`));
}

function activeSpeeds(): string[] {
  return buttons()
    .filter((b) => b.classList.contains(ACTIVE_CLASS))
    .map((b) => b.dataset["speed"]!);
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ensureSpeedButtons", () => {
  it("inserts one group of four buttons directly before the captions button", () => {
    const { controls } = makePlayer();
    expect(ensureSpeedButtons()).toBe(true);
    ensureSpeedButtons();
    const groups = controls.querySelectorAll(`.${GROUP_CLASS}`);
    expect(groups).toHaveLength(1);
    expect(buttons().map((b) => b.textContent)).toEqual(["1.25×", "1.5×", "1.75×", "2×"]);
    expect(groups[0]!.nextElementSibling?.classList.contains("ytp-subtitles-button")).toBe(true);
    for (const b of buttons()) expect(b.classList.contains("ytp-button")).toBe(true);
  });

  it("falls back to the settings button as anchor when captions are absent", () => {
    const { controls } = makePlayer({ anchor: "gear" });
    ensureSpeedButtons();
    const group = controls.querySelector(`.${GROUP_CLASS}`)!;
    expect(group.nextElementSibling?.classList.contains("ytp-settings-button")).toBe(true);
  });

  it("goes first when neither anchor exists", () => {
    const { controls } = makePlayer({ anchor: "none" });
    ensureSpeedButtons();
    expect(controls.firstElementChild?.classList.contains(GROUP_CLASS)).toBe(true);
  });

  it("returns false without a player or without its right controls", () => {
    expect(ensureSpeedButtons()).toBe(false);
    const p = document.createElement("div");
    p.id = "movie_player";
    document.body.appendChild(p);
    expect(ensureSpeedButtons()).toBe(false);
  });

  it("marks no button active at normal speed", () => {
    makePlayer();
    ensureSpeedButtons();
    expect(activeSpeeds()).toEqual([]);
    for (const b of buttons()) expect(b.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("clicking", () => {
  it("sets the rate through the player API and highlights the button", () => {
    const { player } = makePlayer();
    ensureSpeedButtons();
    buttons()[1]!.click();
    expect(player.setPlaybackRate).toHaveBeenCalledWith(1.5);
    expect(currentRate()).toBe(1.5);
    expect(activeSpeeds()).toEqual(["1.5"]);
    expect(buttons()[1]!.getAttribute("aria-pressed")).toBe("true");
  });

  it("switches highlight when another speed is chosen", () => {
    makePlayer();
    ensureSpeedButtons();
    buttons()[0]!.click();
    buttons()[3]!.click();
    expect(currentRate()).toBe(2);
    expect(activeSpeeds()).toEqual(["2"]);
  });

  it("clicking the active speed returns to normal speed", () => {
    const { player } = makePlayer();
    ensureSpeedButtons();
    buttons()[2]!.click();
    buttons()[2]!.click();
    expect(player.setPlaybackRate).toHaveBeenLastCalledWith(1);
    expect(activeSpeeds()).toEqual([]);
  });

  it("falls back to the video element when the player has no API", () => {
    const { video } = makePlayer({ api: false });
    ensureSpeedButtons();
    buttons()[1]!.click();
    expect(video.playbackRate).toBe(1.5);
    expect(activeSpeeds()).toEqual(["1.5"]);
  });

  it("does not bubble to the player (which would toggle play/pause)", () => {
    const { player } = makePlayer();
    ensureSpeedButtons();
    const onPlayer = vi.fn();
    player.addEventListener("click", onPlayer);
    buttons()[0]!.click();
    expect(onPlayer).not.toHaveBeenCalled();
  });
});

describe("external rate changes", () => {
  it("follows a change made via the gear menu (ratechange on the video)", () => {
    const { player } = makePlayer();
    ensureSpeedButtons();
    player.setPlaybackRate(1.75);
    expect(activeSpeeds()).toEqual(["1.75"]);
    player.setPlaybackRate(1);
    expect(activeSpeeds()).toEqual([]);
  });

  it("shows nothing active for a speed not on the bar", () => {
    const { player } = makePlayer();
    ensureSpeedButtons();
    player.setPlaybackRate(0.75);
    expect(activeSpeeds()).toEqual([]);
  });

  it("setRate is a no-op without a player", () => {
    expect(() => setRate(2)).not.toThrow();
  });
});

describe("initSpeedButtons", () => {
  it("does nothing off the watch page", () => {
    makePlayer();
    initSpeedButtons(false);
    expect(buttons()).toHaveLength(0);
  });

  it("waits for a late player on the watch page", async () => {
    initSpeedButtons(true);
    expect(buttons()).toHaveLength(0);
    makePlayer();
    await vi.waitFor(() => expect(buttons()).toHaveLength(SPEEDS.length));
  });
});
