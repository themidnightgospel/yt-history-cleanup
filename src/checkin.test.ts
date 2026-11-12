import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// checkin.ts keeps module state (clock, overlay, preference), so each test
// gets a fresh copy of the module.
type Checkin = typeof import("./checkin.js");
let ck: Checkin;
let assigned: string[];

type Response = {
  videoDetails?: { isLive?: boolean; title?: string };
  microformat?: {
    playerMicroformatRenderer?: { category?: string; liveBroadcastDetails?: { isLiveNow?: boolean } };
  };
};

function makeMasthead(withGrayscale = true): HTMLElement {
  const m = document.createElement("ytd-masthead");
  const end = document.createElement("div");
  end.id = "end";
  if (withGrayscale) {
    const g = document.createElement("button");
    g.className = "ythc-grayscale-toggle";
    end.appendChild(g);
  }
  const bell = document.createElement("button");
  bell.className = "bell";
  end.appendChild(bell);
  m.appendChild(end);
  document.body.appendChild(m);
  return end;
}

function makePlayer(response: Response = { videoDetails: { title: "Octopus RNA" } }) {
  const player = document.createElement("div");
  player.id = "movie_player";
  const video = document.createElement("video");
  video.className = "html5-main-video";
  player.appendChild(video);
  const state = { paused: true, time: 0, ended: false };
  Object.defineProperty(video, "paused", { configurable: true, get: () => state.paused });
  Object.defineProperty(video, "ended", { configurable: true, get: () => state.ended });
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => state.time,
    set: (t: number) => {
      state.time = t;
    },
  });
  video.play = vi.fn(() => {
    if (state.paused) {
      state.paused = false;
      video.dispatchEvent(new Event("play"));
    }
    return Promise.resolve();
  });
  video.pause = vi.fn(() => {
    if (!state.paused) {
      state.paused = true;
      video.dispatchEvent(new Event("pause"));
    }
  });
  (player as unknown as { getPlayerResponse: () => Response }).getPlayerResponse = () => response;
  document.body.appendChild(player);

  /** Plays `seconds` of video time in quarter-second timeupdates, stopping if paused. */
  const advance = (seconds: number, rate = 1): void => {
    const steps = Math.round(seconds * 4);
    for (let i = 0; i < steps && !state.paused; i++) {
      state.time += 0.25 * rate;
      video.dispatchEvent(new Event("timeupdate"));
    }
  };
  return { player, video, state, advance };
}

function overlay(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.${ck.OVERLAY_CLASS}`);
}
function keepBtn(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`.${ck.KEEP_CLASS}`)!;
}
function closeBtn(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`.${ck.CLOSE_CLASS}`)!;
}
function toggle(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`.${ck.TOGGLE_CLASS}`);
}
function goTo(path: string): void {
  history.replaceState(null, "", path);
}
let hidden = false;
/** The masthead's #end, present in every test (as on youtube.com). */
let end: HTMLElement;

/** A watch page with a playing video, as after landing on it. */
function watching(response?: Response) {
  goTo("/watch?v=one");
  const pl = makePlayer(response);
  ck.initCheckin("watch");
  pl.video.play();
  return pl;
}

beforeEach(async () => {
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  vi.useFakeTimers();
  goTo("/watch?v=one");
  vi.resetModules();
  ck = await import("./checkin.js");
  assigned = [];
  ck.navigation.assign = (url: string) => {
    assigned.push(url);
  };
  end = makeMasthead();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the schedule", () => {
  it("first check-in after one minute of playback pauses the video and shows the meme", () => {
    const { video, state, advance } = watching();
    advance(59);
    expect(overlay()).toBeNull();
    advance(2);
    expect(overlay()).not.toBeNull();
    expect(state.paused).toBe(true);
    expect(video.pause).toHaveBeenCalledTimes(1);
    expect(keepBtn().textContent).toBe("On purpose");
    expect(closeBtn().textContent).toBe("Zombie. Close it.");
    expect(overlay()!.querySelectorAll(".ythc-checkin-text")).toHaveLength(2);
    // Inside the player, so it shows in fullscreen too.
    expect(overlay()!.parentElement!.id).toBe("movie_player");
  });

  it("\"On purpose\" resumes, and the next check-in is ten minutes of playback later", () => {
    const { state, advance } = watching();
    advance(61);
    keepBtn().click();
    expect(overlay()).toBeNull();
    expect(state.paused).toBe(false);
    advance(599);
    expect(overlay()).toBeNull();
    advance(2);
    expect(overlay()).not.toBeNull();
  });

  it("counts video time: at 2× the minute mark comes after 30 seconds", () => {
    const { advance } = watching();
    advance(31, 2);
    expect(overlay()).not.toBeNull();
  });

  it("does not count seeks, paused time or ads", () => {
    const { player, video, state, advance } = watching();
    // A seek far ahead is not playback.
    state.time = 300;
    video.dispatchEvent(new Event("seeking"));
    video.dispatchEvent(new Event("timeupdate"));
    advance(30);
    // Ad time does not count.
    player.classList.add("ad-showing");
    advance(60);
    expect(overlay()).toBeNull();
    player.classList.remove("ad-showing");
    advance(31);
    expect(overlay()).not.toBeNull();
  });
});

describe("answering", () => {
  it("no answer within twelve seconds means keep watching", () => {
    const { state, advance } = watching();
    advance(61);
    const cd = document.querySelector(`.${ck.COUNTDOWN_CLASS}`)!;
    expect(cd.textContent).toBe("Resuming in 12 s");
    vi.advanceTimersByTime(1000);
    expect(cd.textContent).toBe("Resuming in 11 s");
    vi.advanceTimersByTime(10_900);
    expect(overlay()).not.toBeNull();
    vi.advanceTimersByTime(200);
    expect(overlay()).toBeNull();
    expect(state.paused).toBe(false);
    advance(599);
    expect(overlay()).toBeNull();
  });

  it("pressing play instead of answering counts as keep watching", () => {
    const { video, advance } = watching();
    advance(61);
    video.play();
    expect(overlay()).toBeNull();
    vi.advanceTimersByTime(6000);
    advance(599);
    expect(overlay()).toBeNull();
    advance(2);
    expect(overlay()).not.toBeNull();
  });

  it("clicks on the meme do not reach the player", () => {
    const { player, advance } = watching();
    advance(61);
    const onPlayer = vi.fn();
    player.addEventListener("click", onPlayer);
    overlay()!.click();
    keepBtn().click();
    expect(onPlayer).not.toHaveBeenCalled();
  });

  it("\"Zombie. Close it.\" leaves a handoff for Undo and goes home", () => {
    const { state, advance } = watching();
    advance(61);
    closeBtn().click();
    expect(overlay()).toBeNull();
    expect(state.paused).toBe(true);
    expect(assigned).toEqual(["/"]);
    const h = JSON.parse(sessionStorage.getItem(ck.UNDO_KEY)!);
    // The check-in fired as playback crossed one minute.
    expect(h).toMatchObject({ v: "one", t: 60, title: "Octopus RNA" });
    expect(h.closedAt).toBe(Date.now());
  });

  it("minute captions count the time watched, not the position in the video", () => {
    // Opened from a link at 40:00 and watched one minute.
    goTo("/watch?v=one&t=2400s");
    const pl = makePlayer();
    pl.state.time = 2400;
    ck.initCheckin("watch");
    pl.video.play();
    pl.advance(61);
    expect(overlay()!.textContent).not.toMatch(/\b40 minutes\b/);
  });
});

describe("don't ask for this one", () => {
  function muteBtn(): HTMLButtonElement {
    return document.querySelector<HTMLButtonElement>(`.${ck.MUTE_CLASS}`)!;
  }

  it("resumes and silences every later check-in for this video", () => {
    const { video, state, advance } = watching();
    advance(61);
    expect(muteBtn().textContent).toBe("Don't ask for this one");
    muteBtn().click();
    expect(overlay()).toBeNull();
    expect(state.paused).toBe(false);
    advance(1200);
    expect(overlay()).toBeNull();
    // Coming back from a long pause does not ask either.
    video.pause();
    vi.advanceTimersByTime(60_000);
    video.play();
    expect(overlay()).toBeNull();
  });

  it("the next video gets check-ins again", () => {
    const { video, advance } = watching();
    advance(61);
    muteBtn().click();
    goTo("/watch?v=two");
    video.dispatchEvent(new Event("loadstart"));
    advance(61);
    expect(overlay()).not.toBeNull();
  });
});

describe("undo", () => {
  it("the home page offers Undo for five seconds from when it appears", () => {
    // The reload to the home page took two seconds.
    sessionStorage.setItem(
      ck.UNDO_KEY,
      JSON.stringify({ v: "one", t: 61, title: "Octopus RNA", closedAt: Date.now() - 2000 }),
    );
    goTo("/");
    ck.initCheckin("home");
    const toast = document.querySelector(".ythc-toast")!;
    expect(toast.textContent).toContain("Closed: Octopus RNA");
    expect(sessionStorage.getItem(ck.UNDO_KEY)).toBeNull();
    vi.advanceTimersByTime(4900);
    expect(document.querySelector(".ythc-toast")).not.toBeNull();
    vi.advanceTimersByTime(200);
    expect(document.querySelector(".ythc-toast")).toBeNull();
  });

  it("Undo goes back to the same second and asks to land paused", () => {
    sessionStorage.setItem(
      ck.UNDO_KEY,
      JSON.stringify({ v: "one", t: 61, title: "Octopus RNA", closedAt: Date.now() }),
    );
    goTo("/");
    ck.initCheckin("home");
    document.querySelector<HTMLButtonElement>(".ythc-toast-action")!.click();
    expect(assigned).toEqual(["/watch?v=one&t=61s"]);
    expect(JSON.parse(sessionStorage.getItem(ck.RESUME_KEY)!)).toEqual({ v: "one" });
    expect(document.querySelector(".ythc-toast")).toBeNull();
  });

  it("a stale handoff (the reload never finished) offers nothing", () => {
    sessionStorage.setItem(
      ck.UNDO_KEY,
      JSON.stringify({ v: "one", t: 61, title: "x", closedAt: Date.now() - 31_000 }),
    );
    goTo("/");
    ck.initCheckin("home");
    expect(document.querySelector(".ythc-toast")).toBeNull();
  });

  it("back on the video, YouTube's autoplay is paused once and counts as keep watching", () => {
    sessionStorage.setItem(ck.RESUME_KEY, JSON.stringify({ v: "one" }));
    goTo("/watch?v=one&t=61s");
    const { video, state, advance } = makePlayer();
    ck.initCheckin("watch");
    video.play(); // YouTube's autoplay
    expect(state.paused).toBe(true);
    expect(sessionStorage.getItem(ck.RESUME_KEY)).toBeNull();
    // The user's own play goes through, and no check-in until ten minutes.
    video.play();
    expect(state.paused).toBe(false);
    advance(599);
    expect(overlay()).toBeNull();
  });

  it("if autoplay never comes, the user's later play is not undone", () => {
    sessionStorage.setItem(ck.RESUME_KEY, JSON.stringify({ v: "one" }));
    const { video, state } = makePlayer();
    ck.initCheckin("watch");
    vi.advanceTimersByTime(9000);
    video.play();
    expect(state.paused).toBe(false);
  });
});

describe("your own pauses", () => {
  it("coming back after 30 seconds or more shows a check-in", () => {
    const { video, state, advance } = watching();
    advance(20);
    video.pause();
    vi.advanceTimersByTime(30_000);
    video.play();
    expect(overlay()).not.toBeNull();
    expect(state.paused).toBe(true);
  });

  it("a short pause does not", () => {
    const { video, advance } = watching();
    advance(20);
    video.pause();
    vi.advanceTimersByTime(29_000);
    video.play();
    expect(overlay()).toBeNull();
  });

  it("our own pause for the check-in does not count as yours", () => {
    const { video, advance } = watching();
    advance(61);
    keepBtn().click();
    vi.advanceTimersByTime(60_000);
    video.pause();
    video.play();
    expect(overlay()).toBeNull();
  });
});

describe("skipped", () => {
  it.each([
    ["a music video", { microformat: { playerMicroformatRenderer: { category: "Music" } } }],
    ["a live stream", { videoDetails: { isLive: true } }],
    [
      "a stream that is live now",
      { microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow: true } } } },
    ],
  ])("for %s", (_name, response) => {
    const { advance } = watching(response as Response);
    advance(120);
    expect(overlay()).toBeNull();
  });

  it("but not for the recording of a finished stream", () => {
    const { advance } = watching({
      microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow: false } } },
    });
    advance(61);
    expect(overlay()).not.toBeNull();
  });

  it("in a playlist the user started", () => {
    goTo("/watch?v=one&list=PL123");
    const { video, advance } = makePlayer();
    ck.initCheckin("watch");
    video.play();
    advance(120);
    expect(overlay()).toBeNull();
  });

  it("while the tab is hidden, until it is visible again", () => {
    const { advance } = watching();
    hidden = true;
    advance(61);
    expect(overlay()).toBeNull();
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(overlay()).not.toBeNull();
  });

  it("a come-back-from-a-pause check-in in a hidden tab lapses instead of firing later", () => {
    const { video, advance } = watching();
    advance(20);
    video.pause();
    vi.advanceTimersByTime(40_000);
    hidden = true;
    video.play();
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(overlay()).toBeNull();
  });

  it("off the watch page (the miniplayer keeps the element playing)", () => {
    const { advance } = watching();
    goTo("/");
    ck.initCheckin("home");
    advance(120);
    expect(overlay()).toBeNull();
  });
});

describe("a new video", () => {
  it("starts its own one-minute clock", () => {
    const { video, advance } = watching();
    advance(50);
    goTo("/watch?v=two");
    video.dispatchEvent(new Event("loadstart"));
    advance(50);
    expect(overlay()).toBeNull();
    advance(11);
    expect(overlay()).not.toBeNull();
  });

  it("removes a check-in still showing for the previous one", () => {
    const { advance } = watching();
    advance(61);
    goTo("/watch?v=two");
    ck.initCheckin("watch");
    expect(overlay()).toBeNull();
  });
});

describe("the masthead control", () => {
  function panel(): HTMLElement {
    return document.querySelector<HTMLElement>(`.${ck.PANEL_CLASS}`)!;
  }
  function part<T extends HTMLElement = HTMLElement>(key: string): T {
    return panel().querySelector<T>(`[data-ythc='${key}']`)!;
  }
  function isOn(key: string): boolean {
    return part(key).getAttribute("aria-checked") === "true";
  }
  function pick(key: string, value: string): void {
    const sel = part<HTMLSelectElement>(key);
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("sits right after the grayscale toggle, on by default", () => {
    ck.initCheckin(null);
    ck.initCheckin(null);
    expect(document.querySelectorAll(`.${ck.TOGGLE_CLASS}`)).toHaveLength(1);
    expect(end.children[0]!.className).toBe("ythc-grayscale-toggle");
    expect(end.children[1]!.className).toBe(ck.CONTROL_CLASS);
    expect(end.children[1]!.contains(toggle())).toBe(true);
    expect(toggle()!.getAttribute("aria-pressed")).toBe("true");
    expect(toggle()!.getAttribute("aria-label")).toBe("Watch check-ins");
    // An outlined zombie, drawn with strokes like YouTube's own header icons.
    const svg = toggle()!.querySelector("svg")!;
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.querySelectorAll("path")).toHaveLength(3);
  });

  it("goes first when there is no grayscale toggle", () => {
    end.querySelector(".ythc-grayscale-toggle")!.remove();
    ck.initCheckin(null);
    expect(end.firstElementChild!.contains(toggle())).toBe(true);
  });

  it("opens and closes its panel; a click elsewhere or Escape closes it", () => {
    ck.initCheckin(null);
    expect(panel().hidden).toBe(true);
    toggle()!.click();
    expect(panel().hidden).toBe(false);
    expect(toggle()!.getAttribute("aria-expanded")).toBe("true");
    // Clicks inside keep it open.
    part("expand").click();
    expect(panel().hidden).toBe(false);
    document.body.click();
    expect(panel().hidden).toBe(true);
    expect(toggle()!.getAttribute("aria-expanded")).toBe("false");

    toggle()!.click();
    part("from").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(toggle());
  });

  it("the switch turns check-ins off, stores the choice, and stops them", () => {
    const { advance } = watching();
    toggle()!.click();
    expect(part("enabled").getAttribute("role")).toBe("switch");
    expect(isOn("enabled")).toBe(true);
    part("enabled").click();
    expect(isOn("enabled")).toBe(false);
    expect(localStorage.getItem(ck.STORAGE_KEY)).toBe("0");
    expect(toggle()!.getAttribute("aria-pressed")).toBe("false");
    advance(120);
    expect(overlay()).toBeNull();
  });

  it("switching off mid check-in lets the video carry on", () => {
    const { state, advance } = watching();
    advance(61);
    ck.setCheckinEnabled(false);
    expect(overlay()).toBeNull();
    expect(state.paused).toBe(false);
  });

  it("switching back on counts from then, not from playback while it was off", () => {
    const { advance } = watching();
    ck.setCheckinEnabled(false);
    advance(300);
    ck.setCheckinEnabled(true);
    advance(5);
    expect(overlay()).toBeNull();
    advance(56);
    expect(overlay()).not.toBeNull();
  });

  it("a stored off is honoured on load, and another tab's change is followed", async () => {
    localStorage.setItem("ythc-checkin", "0");
    vi.resetModules();
    ck = await import("./checkin.js");
    ck.initCheckin(null);
    expect(ck.isCheckinEnabled()).toBe(false);
    localStorage.setItem("ythc-checkin", "1");
    window.dispatchEvent(new StorageEvent("storage", { key: "ythc-checkin" }));
    expect(ck.isCheckinEnabled()).toBe(true);
    expect(toggle()!.getAttribute("aria-pressed")).toBe("true");
  });

  it("the quiet hours row is folded and reads Off; clicking it unfolds the pickers", () => {
    ck.initCheckin(null);
    toggle()!.click();
    expect(part("summary").textContent).toBe("Off");
    const times = panel().querySelector<HTMLElement>(".ythc-menu-times")!;
    expect(times.hidden).toBe(true);
    part("expand").click();
    expect(times.hidden).toBe(false);
    expect(part("expand").getAttribute("aria-expanded")).toBe("true");
    part("expand").click();
    expect(times.hidden).toBe(true);
  });

  it("quiet hours start off, prefilled 21:00 to 06:00 in half-hour steps, with the pickers disabled", () => {
    ck.initCheckin(null);
    toggle()!.click();
    expect(isOn("quiet")).toBe(false);
    expect(part<HTMLSelectElement>("from").value).toBe("21:00");
    expect(part<HTMLSelectElement>("to").value).toBe("06:00");
    expect(part<HTMLSelectElement>("from").disabled).toBe(true);
    expect(part<HTMLSelectElement>("from").options).toHaveLength(48);
    // Labels follow the user's clock format.
    expect(part<HTMLSelectElement>("from").selectedOptions[0]!.textContent).toBe(ck.formatTime("21:00"));
  });

  it("setting quiet hours stores them, shows them, and stops check-ins inside them", () => {
    vi.setSystemTime(new Date(2026, 10, 12, 22, 30));
    const { advance } = watching();
    toggle()!.click();
    part("expand").click();
    part("quiet").click();
    pick("from", "21:00");
    pick("to", "07:00");
    expect(JSON.parse(localStorage.getItem(ck.QUIET_KEY)!)).toEqual({ on: true, from: "21:00", to: "07:00" });
    expect(part<HTMLSelectElement>("from").disabled).toBe(false);
    const range = `${ck.formatTime("21:00")} – ${ck.formatTime("07:00")}`;
    expect(part("summary").textContent).toBe(`No check-ins ${range}`);
    expect(toggle()!.title).toContain(`relax time ${range}`);
    advance(120);
    expect(overlay()).toBeNull();
  });

  it("outside quiet hours the check-ins come as usual", () => {
    vi.setSystemTime(new Date(2026, 10, 12, 15, 0));
    ck.setQuietHours({ on: true, from: "21:00", to: "07:00" });
    const { advance } = watching();
    advance(61);
    expect(overlay()).not.toBeNull();
  });

  it("stored quiet hours are read on load; broken ones fall back to the defaults", async () => {
    localStorage.setItem("ythc-checkin-quiet", JSON.stringify({ on: true, from: "20:30", to: "nope" }));
    vi.resetModules();
    ck = await import("./checkin.js");
    ck.initCheckin(null);
    toggle()!.click();
    expect(isOn("quiet")).toBe(true);
    expect(part<HTMLSelectElement>("from").value).toBe("20:30");
    expect(part<HTMLSelectElement>("to").value).toBe("06:00");
  });

  it("a stored time between the half hours is kept and offered in its place", async () => {
    localStorage.setItem("ythc-checkin-quiet", JSON.stringify({ on: true, from: "21:15", to: "06:00" }));
    vi.resetModules();
    ck = await import("./checkin.js");
    ck.initCheckin(null);
    toggle()!.click();
    const from = part<HTMLSelectElement>("from");
    expect(from.value).toBe("21:15");
    const values = Array.from(from.options).map((o) => o.value);
    expect(values.indexOf("21:15")).toBe(values.indexOf("21:00") + 1);
  });
});

describe("inQuietHours", () => {
  const at = (h: number, m = 0): Date => new Date(2026, 10, 12, h, m);
  const q = (from: string, to: string, on = true) => ({ on, from, to });

  it("wraps past midnight when from is later than to", () => {
    expect(ck.inQuietHours(q("21:00", "06:00"), at(23))).toBe(true);
    expect(ck.inQuietHours(q("21:00", "06:00"), at(2))).toBe(true);
    expect(ck.inQuietHours(q("21:00", "06:00"), at(6))).toBe(false);
    expect(ck.inQuietHours(q("21:00", "06:00"), at(20, 59))).toBe(false);
    expect(ck.inQuietHours(q("21:00", "06:00"), at(21))).toBe(true);
  });

  it("covers a same-day range", () => {
    expect(ck.inQuietHours(q("12:00", "13:30"), at(13, 29))).toBe(true);
    expect(ck.inQuietHours(q("12:00", "13:30"), at(13, 30))).toBe(false);
    expect(ck.inQuietHours(q("12:00", "13:30"), at(11, 59))).toBe(false);
  });

  it("is never quiet when off, or when from equals to", () => {
    expect(ck.inQuietHours(q("21:00", "06:00", false), at(23))).toBe(false);
    expect(ck.inQuietHours(q("09:00", "09:00"), at(9))).toBe(false);
  });
});
