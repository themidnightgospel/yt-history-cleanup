import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// checkin.ts keeps module state (clock, overlay, preference), so each test
// gets a fresh copy of the module.
type Checkin = typeof import("./checkin.js");
let ck: Checkin;
let assigned: string[];

type Response = {
  videoDetails?: { isLive?: boolean; title?: string };
  microformat?: { playerMicroformatRenderer?: { category?: string; isLiveBroadcast?: boolean } };
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
  it("no answer within five seconds means keep watching", () => {
    const { state, advance } = watching();
    advance(61);
    const cd = document.querySelector(`.${ck.COUNTDOWN_CLASS}`)!;
    expect(cd.textContent).toBe("Resuming in 5 s");
    vi.advanceTimersByTime(1000);
    expect(cd.textContent).toBe("Resuming in 4 s");
    vi.advanceTimersByTime(3900);
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
    expect(h.until).toBe(Date.now() + ck.UNDO_MS);
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
  it("the home page offers Undo for the rest of five seconds, then it goes", () => {
    sessionStorage.setItem(
      ck.UNDO_KEY,
      JSON.stringify({ v: "one", t: 61, title: "Octopus RNA", until: Date.now() + 4000 }),
    );
    goTo("/");
    ck.initCheckin("home");
    const toast = document.querySelector(".ythc-toast")!;
    expect(toast.textContent).toContain("Closed: Octopus RNA");
    expect(sessionStorage.getItem(ck.UNDO_KEY)).toBeNull();
    vi.advanceTimersByTime(4100);
    expect(document.querySelector(".ythc-toast")).toBeNull();
  });

  it("Undo goes back to the same second and asks to land paused", () => {
    sessionStorage.setItem(
      ck.UNDO_KEY,
      JSON.stringify({ v: "one", t: 61, title: "Octopus RNA", until: Date.now() + 5000 }),
    );
    goTo("/");
    ck.initCheckin("home");
    document.querySelector<HTMLButtonElement>(".ythc-toast-action")!.click();
    expect(assigned).toEqual(["/watch?v=one&t=61s"]);
    expect(JSON.parse(sessionStorage.getItem(ck.RESUME_KEY)!)).toEqual({ v: "one" });
    expect(document.querySelector(".ythc-toast")).toBeNull();
  });

  it("an expired handoff offers nothing", () => {
    sessionStorage.setItem(
      ck.UNDO_KEY,
      JSON.stringify({ v: "one", t: 61, title: "x", until: Date.now() - 1 }),
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
    ["a live broadcast", { microformat: { playerMicroformatRenderer: { isLiveBroadcast: true } } }],
  ])("for %s", (_name, response) => {
    const { advance } = watching(response as Response);
    advance(120);
    expect(overlay()).toBeNull();
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

describe("the masthead toggle", () => {
  it("sits right after the grayscale toggle, on by default", () => {
    ck.initCheckin(null);
    ck.initCheckin(null);
    expect(document.querySelectorAll(`.${ck.TOGGLE_CLASS}`)).toHaveLength(1);
    expect(end.children[0]!.className).toBe("ythc-grayscale-toggle");
    expect(end.children[1]).toBe(toggle());
    expect(toggle()!.getAttribute("aria-pressed")).toBe("true");
    expect(toggle()!.getAttribute("aria-label")).toBe("Watch check-ins");
  });

  it("goes first when there is no grayscale toggle", () => {
    end.querySelector(".ythc-grayscale-toggle")!.remove();
    ck.initCheckin(null);
    expect(end.firstElementChild).toBe(toggle());
  });

  it("turning it off stores the choice and stops check-ins", () => {
    const { advance } = watching();
    toggle()!.click();
    expect(localStorage.getItem(ck.STORAGE_KEY)).toBe("0");
    expect(toggle()!.getAttribute("aria-pressed")).toBe("false");
    advance(120);
    expect(overlay()).toBeNull();
  });

  it("turning it off mid check-in lets the video carry on", () => {
    const { state, advance } = watching();
    advance(61);
    toggle()!.click();
    expect(overlay()).toBeNull();
    expect(state.paused).toBe(false);
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
});
