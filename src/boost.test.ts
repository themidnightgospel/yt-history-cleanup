import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// boost.ts keeps module state (chosen boost, audio graph, current video), so
// each test gets a fresh copy of the module.
type Boost = typeof import("./boost.js");
let boost: Boost;

// --- Web Audio stand-in ------------------------------------------------------

class FakeNode {
  connected: FakeNode[] = [];
  connect(n: FakeNode): FakeNode {
    this.connected.push(n);
    return n;
  }
}
class FakeParam {
  constructor(public value: number) {}
  // The fake lands on a glide's target at once.
  setTargetAtTime(target: number): void {
    this.value = target;
  }
  cancelScheduledValues(): void {}
}
class FakeContext {
  static instances: FakeContext[] = [];
  state = "suspended";
  currentTime = 0;
  destination = new FakeNode();
  sources: HTMLMediaElement[] = [];
  gain = Object.assign(new FakeNode(), { gain: new FakeParam(1) });
  limiter = Object.assign(new FakeNode(), {
    threshold: new FakeParam(0),
    knee: new FakeParam(0),
    ratio: new FakeParam(0),
    attack: new FakeParam(0),
    release: new FakeParam(0),
  });
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
  constructor() {
    FakeContext.instances.push(this);
  }
  createMediaElementSource(el: HTMLMediaElement): FakeNode {
    if (el.dataset["captured"]) throw new DOMException("already connected", "InvalidStateError");
    el.dataset["captured"] = "1";
    this.sources.push(el);
    return new FakeNode();
  }
  createGain(): FakeNode {
    return this.gain;
  }
  createDynamicsCompressor(): FakeNode {
    return this.limiter;
  }
}

function ctx(): FakeContext {
  return FakeContext.instances.at(-1)!;
}
function gainValue(): number | undefined {
  return FakeContext.instances.at(-1)?.gain.gain.value;
}

// --- DOM stand-in -------------------------------------------------------------

function makePlayer(opts: { speed?: boolean; nested?: boolean } = {}): {
  player: HTMLElement;
  video: HTMLVideoElement;
  controls: HTMLElement;
} {
  const { speed = true, nested = false } = opts;
  const player = document.createElement("div");
  player.id = "movie_player";
  const video = document.createElement("video");
  video.className = "html5-main-video";
  player.appendChild(video);
  const controls = document.createElement("div");
  controls.className = "ytp-right-controls";
  let cluster: HTMLElement = controls;
  if (nested) {
    cluster = document.createElement("div");
    cluster.className = "ytp-right-controls-left";
    controls.appendChild(cluster);
  }
  if (speed) {
    const g = document.createElement("div");
    g.className = "ythc-speed-group";
    controls.appendChild(g);
  }
  const cc = document.createElement("button");
  cc.className = "ytp-button ytp-subtitles-button";
  cluster.appendChild(cc);
  player.appendChild(controls);
  document.body.appendChild(player);
  return { player, video, controls };
}

function btn(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`.${boost.BUTTON_CLASS}`)!;
}
function chips(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(`.${boost.CHIP_CLASS}`));
}
function activeChips(): string[] {
  return chips()
    .filter((c) => c.classList.contains(boost.ACTIVE_CLASS))
    .map((c) => c.dataset["boost"]!);
}
function boostAttr(): string | null {
  return document.getElementById("movie_player")!.getAttribute(boost.BOOST_ATTR);
}
function goTo(path: string): void {
  history.replaceState(null, "", path);
}

beforeEach(async () => {
  document.body.innerHTML = "";
  FakeContext.instances = [];
  vi.stubGlobal("AudioContext", FakeContext);
  goTo("/watch?v=one");
  vi.resetModules();
  boost = await import("./boost.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ensureBoostButton", () => {
  it("inserts one group with the icon button and three chips, left of the speed group", () => {
    const { controls } = makePlayer();
    expect(boost.ensureBoostButton()).toBe(true);
    boost.ensureBoostButton();
    expect(controls.querySelectorAll(`.${boost.GROUP_CLASS}`)).toHaveLength(1);
    expect(btn().classList.contains("ytp-button")).toBe(true);
    expect(btn().querySelector("svg")).not.toBeNull();
    expect(chips().map((c) => c.textContent)).toEqual(["1.5×", "2×", "3×"]);
    const group = controls.querySelector(`.${boost.GROUP_CLASS}`)!;
    expect(group.nextElementSibling?.classList.contains("ythc-speed-group")).toBe(true);
  });

  it("goes in front of the captions anchor when the speed group is not there yet", () => {
    const { controls } = makePlayer({ speed: false, nested: true });
    boost.ensureBoostButton();
    const group = controls.querySelector(`.${boost.GROUP_CLASS}`)!;
    expect(group.parentElement).toBe(controls);
    expect(group.nextElementSibling?.classList.contains("ytp-right-controls-left")).toBe(true);
  });

  it("returns false without a player or its right controls", () => {
    expect(boost.ensureBoostButton()).toBe(false);
    const p = document.createElement("div");
    p.id = "movie_player";
    document.body.appendChild(p);
    expect(boost.ensureBoostButton()).toBe(false);
  });

  it("starts off: no attribute, nothing active, no audio graph", () => {
    makePlayer();
    boost.ensureBoostButton();
    expect(boostAttr()).toBeNull();
    expect(btn().getAttribute("aria-pressed")).toBe("false");
    expect(btn().querySelector(`.${boost.MULT_CLASS}`)!.textContent).toBe("");
    expect(activeChips()).toEqual([]);
    expect(FakeContext.instances).toHaveLength(0);
  });
});

describe("choosing a boost", () => {
  it("a chip click builds the graph once, sets the gain and marks the UI", () => {
    const { video } = makePlayer();
    boost.ensureBoostButton();
    chips()[1]!.click();
    expect(FakeContext.instances).toHaveLength(1);
    expect(ctx().sources).toEqual([video]);
    expect(gainValue()).toBe(2);
    expect(ctx().resume).toHaveBeenCalled();
    expect(boost.currentBoost()).toBe(2);
    expect(boostAttr()).toBe("2");
    expect(btn().classList.contains(boost.ACTIVE_CLASS)).toBe(true);
    expect(btn().getAttribute("aria-pressed")).toBe("true");
    expect(btn().querySelector(`.${boost.MULT_CLASS}`)!.textContent).toBe("2×");
    expect(activeChips()).toEqual(["2"]);
    expect(chips()[1]!.getAttribute("aria-checked")).toBe("true");

    chips()[2]!.click();
    expect(FakeContext.instances).toHaveLength(1);
    expect(gainValue()).toBe(3);
    expect(activeChips()).toEqual(["3"]);
  });

  it("wires gain into the limiter and the limiter into the speakers", () => {
    makePlayer();
    boost.ensureBoostButton();
    chips()[0]!.click();
    const c = ctx();
    expect(c.gain.connected).toEqual([c.limiter]);
    expect(c.limiter.connected).toEqual([c.destination]);
    expect(c.limiter.ratio.value).toBeGreaterThan(1);
    // Any lower threshold brings the compressor's automatic makeup gain,
    // and 1× would play louder than native.
    expect(c.limiter.threshold.value).toBe(0);
  });

  it("clicking the active chip returns to 1× but keeps the graph", () => {
    makePlayer();
    boost.ensureBoostButton();
    chips()[0]!.click();
    chips()[0]!.click();
    expect(boost.currentBoost()).toBe(1);
    expect(gainValue()).toBe(1);
    expect(boostAttr()).toBeNull();
    expect(activeChips()).toEqual([]);
    expect(btn().classList.contains(boost.ACTIVE_CLASS)).toBe(false);
  });

  it("the icon button toggles off and back on to the last used stop", () => {
    makePlayer();
    boost.ensureBoostButton();
    chips()[2]!.click();
    btn().click();
    expect(boost.currentBoost()).toBe(1);
    btn().click();
    expect(boost.currentBoost()).toBe(3);
    expect(gainValue()).toBe(3);
  });

  it("the icon button turns on at 2× before any stop has been used", () => {
    makePlayer();
    boost.ensureBoostButton();
    btn().click();
    expect(boost.currentBoost()).toBe(boost.DEFAULT_BOOST);
    expect(gainValue()).toBe(2);
  });

  it("stays at 1× and warns when the element cannot be captured", () => {
    const { video } = makePlayer();
    video.dataset["captured"] = "1";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    boost.ensureBoostButton();
    chips()[1]!.click();
    expect(warn).toHaveBeenCalled();
    // The choice is still shown; nothing is audible until a working element appears.
    expect(boost.currentBoost()).toBe(2);
    expect(gainValue()).toBe(1);
  });

  it("frees the context of a failed capture and never retries that element", async () => {
    const { player, video } = makePlayer();
    video.dataset["captured"] = "1";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    boost.ensureBoostButton();
    chips()[1]!.click();
    expect(FakeContext.instances).toHaveLength(1);
    expect(ctx().close).toHaveBeenCalled();
    // YouTube rewrites the player's classes constantly; none of that, nor
    // another pick, may build more contexts.
    player.classList.add("ytp-autohide");
    player.classList.add("ad-showing");
    player.classList.remove("ad-showing");
    await new Promise((r) => setTimeout(r, 0));
    chips()[2]!.click();
    expect(FakeContext.instances).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does nothing audible without Web Audio", () => {
    vi.stubGlobal("AudioContext", undefined);
    makePlayer();
    boost.ensureBoostButton();
    expect(() => chips()[1]!.click()).not.toThrow();
    expect(boost.currentBoost()).toBe(2);
  });

  it("a mouse click drops the focus it leaves behind; a keyboard press keeps it", () => {
    makePlayer();
    boost.ensureBoostButton();
    // Chrome focuses a clicked button; that focus would hold the row open.
    chips()[0]!.focus();
    chips()[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(boost.currentBoost()).toBe(1.5);
    expect(document.activeElement).toBe(document.body);
    // Enter / Space on a focused button click with detail 0.
    chips()[1]!.focus();
    chips()[1]!.click();
    expect(boost.currentBoost()).toBe(2);
    expect(document.activeElement).toBe(chips()[1]);
  });

  it("clicks do not bubble to the player (which would toggle play/pause)", () => {
    const { player } = makePlayer();
    boost.ensureBoostButton();
    const onPlayer = vi.fn();
    player.addEventListener("click", onPlayer);
    btn().click();
    chips()[0]!.click();
    expect(onPlayer).not.toHaveBeenCalled();
  });
});

describe("the drop-up", () => {
  it("mirrors hover and focus in aria-expanded, Escape blurs", () => {
    makePlayer();
    boost.ensureBoostButton();
    const group = document.querySelector<HTMLElement>(`.${boost.GROUP_CLASS}`)!;
    expect(btn().getAttribute("aria-expanded")).toBe("false");
    group.dispatchEvent(new Event("pointerenter"));
    expect(btn().getAttribute("aria-expanded")).toBe("true");
    group.dispatchEvent(new Event("pointerleave"));
    expect(btn().getAttribute("aria-expanded")).toBe("false");

    chips()[0]!.focus();
    expect(btn().getAttribute("aria-expanded")).toBe("true");
    chips()[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).not.toBe(chips()[0]);
  });
});

describe("ads", () => {
  it("lifts the boost while the player shows an ad and restores it after", async () => {
    const { player } = makePlayer();
    boost.ensureBoostButton();
    chips()[2]!.click();
    expect(gainValue()).toBe(3);

    player.classList.add("ad-showing");
    await vi.waitFor(() => expect(gainValue()).toBe(1));
    expect(boost.effectiveGain()).toBe(1);
    // The choice is kept and still shown.
    expect(boost.currentBoost()).toBe(3);
    expect(activeChips()).toEqual(["3"]);
    expect(boostAttr()).toBe("3");

    player.classList.remove("ad-showing");
    await vi.waitFor(() => expect(gainValue()).toBe(3));
  });

  it("acts only when ad-showing flips, not on YouTube's other class churn", async () => {
    const { player } = makePlayer();
    boost.ensureBoostButton();
    chips()[2]!.click();
    ctx().gain.gain.value = 42; // a marker: any applyGain would overwrite it
    player.classList.add("ytp-autohide");
    await new Promise((r) => setTimeout(r, 0));
    expect(gainValue()).toBe(42);
    player.classList.add("ad-showing");
    await vi.waitFor(() => expect(gainValue()).toBe(1));
  });
});

describe("initBoostButton", () => {
  it("does nothing off the watch page", () => {
    makePlayer();
    boost.initBoostButton(false);
    expect(document.querySelector(`.${boost.GROUP_CLASS}`)).toBeNull();
  });

  it("waits for a late player on the watch page", async () => {
    boost.initBoostButton(true);
    expect(document.querySelector(`.${boost.GROUP_CLASS}`)).toBeNull();
    makePlayer();
    await vi.waitFor(() => expect(chips()).toHaveLength(boost.BOOSTS.length));
  });

  it("resets to 1× when the video changes, keeps it on re-routes of the same video", () => {
    makePlayer();
    boost.initBoostButton(true);
    chips()[1]!.click();
    boost.initBoostButton(true);
    expect(boost.currentBoost()).toBe(2);

    goTo("/watch?v=two");
    boost.initBoostButton(true);
    expect(boost.currentBoost()).toBe(1);
    expect(gainValue()).toBe(1);
    expect(boostAttr()).toBeNull();
    // The icon button still remembers the last stop.
    btn().click();
    expect(boost.currentBoost()).toBe(2);
  });

  it("resets as soon as the next video starts loading, before the route event", () => {
    const { video } = makePlayer();
    boost.initBoostButton(true);
    chips()[2]!.click();
    // YouTube updates the URL, then loads the next video into the same
    // element, possibly playing it before yt-navigate-finish.
    goTo("/watch?v=two");
    video.dispatchEvent(new Event("loadstart"));
    expect(boost.currentBoost()).toBe(1);
    expect(gainValue()).toBe(1);
    // The route that follows sees the id already current and leaves 1×.
    btn().click();
    boost.initBoostButton(true);
    expect(boost.currentBoost()).toBe(3);
  });

  it("keeps the boost when the same video reloads (an ad, a source switch)", () => {
    const { video } = makePlayer();
    boost.initBoostButton(true);
    chips()[2]!.click();
    video.dispatchEvent(new Event("loadstart"));
    expect(boost.currentBoost()).toBe(3);
  });

  it("resets when leaving the watch page", () => {
    makePlayer();
    boost.initBoostButton(true);
    chips()[0]!.click();
    goTo("/");
    boost.initBoostButton(false);
    expect(boost.currentBoost()).toBe(1);
    expect(gainValue()).toBe(1);
  });

  it("rebuilds the graph for a swapped video element", () => {
    const { player, video } = makePlayer();
    boost.initBoostButton(true);
    chips()[1]!.click();
    const first = ctx();

    const replacement = document.createElement("video");
    replacement.className = "html5-main-video";
    player.replaceChild(replacement, video);
    goTo("/watch?v=three");
    boost.initBoostButton(true);
    // The reset to 1× must not capture the new element.
    expect(FakeContext.instances).toHaveLength(1);
    expect(replacement.dataset["captured"]).toBeUndefined();
    chips()[2]!.click();
    expect(FakeContext.instances).toHaveLength(2);
    expect(first.close).toHaveBeenCalled();
    expect(ctx().sources).toEqual([replacement]);
    expect(gainValue()).toBe(3);
  });
});
