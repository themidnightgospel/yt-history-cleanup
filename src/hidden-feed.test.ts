import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  peekRemaining,
  formatRemaining,
  initHiddenFeed,
  isFeedHidden,
  showFeedForAMinute,
  hideFeedNow,
  ensurePrompt,
  ensureUpNextNote,
  resetHiddenFeedForTests,
  navigation,
  SHOWN_UNTIL_KEY,
  HIDDEN_ATTR,
  TOGGLE_CLASS,
  PILL_CLASS,
  PROMPT_CLASS,
  UPNEXT_NOTE_CLASS,
  PEEK_MS,
} from "./hidden-feed.js";

const T0 = new Date("2026-11-17T12:00:00Z").getTime();

function makeMasthead(): HTMLElement {
  const masthead = document.createElement("ytd-masthead");
  const end = document.createElement("div");
  end.id = "end";
  const buttons = document.createElement("div");
  buttons.id = "buttons";
  end.appendChild(buttons);
  masthead.appendChild(end);
  document.body.appendChild(masthead);
  return end;
}

function makeGrid(): HTMLElement {
  const primary = document.createElement("div");
  primary.id = "primary";
  const grid = document.createElement("ytd-rich-grid-renderer");
  primary.appendChild(grid);
  document.body.appendChild(primary);
  return grid;
}

const toggle = () => document.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`)!;
const prompt = () => document.querySelector<HTMLElement>(`.${PROMPT_CLASS}`);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  resetHiddenFeedForTests();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute(HIDDEN_ATTR);
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  resetHiddenFeedForTests();
  vi.useRealTimers();
});

describe("peekRemaining", () => {
  it("is 0 when nothing is stored", () => {
    expect(peekRemaining(null, T0)).toBe(0);
  });

  it("is the time left of a running peek", () => {
    expect(peekRemaining(String(T0 + 42_000), T0)).toBe(42_000);
  });

  it("is 0 once the peek has ended", () => {
    expect(peekRemaining(String(T0 - 1), T0)).toBe(0);
    expect(peekRemaining(String(T0), T0)).toBe(0);
  });

  it("treats an end more than one peek away as hidden, not a long reveal", () => {
    expect(peekRemaining(String(T0 + PEEK_MS + 1), T0)).toBe(0);
    expect(peekRemaining(String(T0 + PEEK_MS), T0)).toBe(PEEK_MS);
  });

  it("treats garbage as hidden", () => {
    expect(peekRemaining("soon", T0)).toBe(0);
  });
});

describe("formatRemaining", () => {
  it("shows minutes and seconds, rounding up", () => {
    expect(formatRemaining(60_000)).toBe("1:00");
    expect(formatRemaining(42_000)).toBe("0:42");
    expect(formatRemaining(41_001)).toBe("0:42");
    expect(formatRemaining(1)).toBe("0:01");
    expect(formatRemaining(0)).toBe("0:00");
  });
});

describe("initHiddenFeed", () => {
  it("hides the feed by default and adds a pressed masthead button", () => {
    makeMasthead();
    initHiddenFeed(null);
    expect(isFeedHidden()).toBe(true);
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(toggle().classList.contains(PILL_CLASS)).toBe(false);
    expect(toggle().title).toMatch(/hidden/);
  });

  it("goes after our other masthead controls", () => {
    const end = makeMasthead();
    const gray = document.createElement("button");
    gray.className = "ythc-grayscale-toggle";
    const zombie = document.createElement("div");
    zombie.className = "ythc-checkin-control";
    end.prepend(gray, zombie);
    initHiddenFeed(null);
    expect(zombie.nextElementSibling).toBe(toggle());
  });

  it("waits for a masthead that is not stamped yet", async () => {
    initHiddenFeed(null);
    expect(document.querySelector(`.${TOGGLE_CLASS}`)).toBeNull();
    makeMasthead();
    await vi.waitFor(() => expect(document.querySelector(`.${TOGGLE_CLASS}`)).not.toBeNull());
  });

  it("picks up a peek still running from before a reload", () => {
    makeMasthead();
    localStorage.setItem(SHOWN_UNTIL_KEY, String(T0 + 30_000));
    initHiddenFeed(null);
    expect(isFeedHidden()).toBe(false);
    expect(toggle().textContent).toBe("0:30");
  });

  it("is idempotent across navigations", () => {
    makeMasthead();
    initHiddenFeed(null);
    initHiddenFeed(null);
    expect(document.querySelectorAll(`.${TOGGLE_CLASS}`)).toHaveLength(1);
  });

  it("follows a peek started in another tab", () => {
    makeMasthead();
    initHiddenFeed(null);
    localStorage.setItem(SHOWN_UNTIL_KEY, String(T0 + 20_000));
    window.dispatchEvent(new StorageEvent("storage", { key: SHOWN_UNTIL_KEY }));
    expect(isFeedHidden()).toBe(false);
  });
});

describe("the masthead button", () => {
  it("shows the feed for one minute, as a pill counting down", () => {
    makeMasthead();
    initHiddenFeed(null);
    toggle().click();
    expect(isFeedHidden()).toBe(false);
    expect(localStorage.getItem(SHOWN_UNTIL_KEY)).toBe(String(T0 + PEEK_MS));
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(toggle().classList.contains(PILL_CLASS)).toBe(true);
    expect(toggle().textContent).toBe("1:00");
    vi.advanceTimersByTime(18_000);
    expect(toggle().textContent).toBe("0:42");
  });

  it("hides the feed again when the minute is up", () => {
    makeMasthead();
    initHiddenFeed(null);
    toggle().click();
    vi.advanceTimersByTime(PEEK_MS - 500);
    expect(isFeedHidden()).toBe(false);
    vi.advanceTimersByTime(500);
    expect(isFeedHidden()).toBe(true);
    expect(toggle().classList.contains(PILL_CLASS)).toBe(false);
  });

  it("says so in a toast when the feed hides on the home page", () => {
    history.replaceState(null, "", "/");
    makeMasthead();
    initHiddenFeed("home");
    toggle().click();
    vi.advanceTimersByTime(PEEK_MS);
    expect(document.querySelector(".ythc-toast")?.textContent).toMatch(/hidden again/);
  });

  it("hides the feed at once when clicked during the minute", () => {
    makeMasthead();
    initHiddenFeed(null);
    toggle().click();
    toggle().click();
    expect(isFeedHidden()).toBe(true);
    expect(localStorage.getItem(SHOWN_UNTIL_KEY)).toBeNull();
  });

  it("still works for the life of the page when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    makeMasthead();
    initHiddenFeed(null);
    showFeedForAMinute();
    expect(isFeedHidden()).toBe(false);
    hideFeedNow();
    expect(isFeedHidden()).toBe(true);
  });
});

describe("the prompt", () => {
  it("goes just before the home grid, once", () => {
    const grid = makeGrid();
    initHiddenFeed("home");
    initHiddenFeed("home");
    expect(document.querySelectorAll(`.${PROMPT_CLASS}`)).toHaveLength(1);
    expect(grid.previousElementSibling).toBe(prompt());
    expect(prompt()!.querySelector("h2")!.textContent).toBe("What did you come here for?");
  });

  it("skips another feed's grid that YouTube keeps alive, and waits for the home one", async () => {
    history.replaceState(null, "", "/");
    const subs = document.createElement("ytd-browse");
    subs.setAttribute("page-subtype", "subscriptions");
    subs.appendChild(document.createElement("ytd-rich-grid-renderer"));
    document.body.appendChild(subs);
    ensurePrompt();
    expect(prompt()).toBeNull();
    const home = document.createElement("ytd-browse");
    home.setAttribute("page-subtype", "home");
    const grid = document.createElement("ytd-rich-grid-renderer");
    home.appendChild(grid);
    document.body.appendChild(home);
    await vi.waitFor(() => expect(grid.previousElementSibling).toBe(prompt()));
  });

  it("is not added off the home page", () => {
    makeGrid();
    initHiddenFeed(null);
    expect(prompt()).toBeNull();
  });

  it("waits for a grid that has not rendered yet", async () => {
    history.replaceState(null, "", "/");
    ensurePrompt();
    expect(prompt()).toBeNull();
    makeGrid();
    await vi.waitFor(() => expect(prompt()).not.toBeNull());
  });

  it("searches YouTube for what you type", () => {
    makeGrid();
    initHiddenFeed("home");
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => {});
    prompt()!.querySelector("input")!.value = "  sourdough starter  ";
    prompt()!.querySelector("form")!.requestSubmit();
    expect(assign).toHaveBeenCalledWith("/results?search_query=sourdough%20starter");
  });

  it("does nothing on an empty answer", () => {
    makeGrid();
    initHiddenFeed("home");
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => {});
    prompt()!.querySelector("form")!.requestSubmit();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("the watch page", () => {
  function makeUpNext(): HTMLElement {
    const secondary = document.createElement("div");
    secondary.id = "secondary";
    const list = document.createElement("ytd-watch-next-secondary-results-renderer");
    secondary.appendChild(list);
    document.body.appendChild(secondary);
    return list;
  }
  const note = () => document.querySelector<HTMLElement>(`.${UPNEXT_NOTE_CLASS}`);

  it("puts a note just before the Up next list, once", () => {
    const list = makeUpNext();
    initHiddenFeed("watch");
    initHiddenFeed("watch");
    expect(document.querySelectorAll(`.${UPNEXT_NOTE_CLASS}`)).toHaveLength(1);
    expect(list.previousElementSibling).toBe(note());
    expect(note()!.textContent).toMatch(/Up next is hidden/);
  });

  it("waits for an Up next list that has not rendered yet", async () => {
    history.replaceState(null, "", "/watch?v=abc");
    ensureUpNextNote();
    expect(note()).toBeNull();
    const list = makeUpNext();
    await vi.waitFor(() => expect(list.previousElementSibling).toBe(note()));
  });

  it("adds neither the note nor the prompt elsewhere", () => {
    makeUpNext();
    makeGrid();
    initHiddenFeed(null);
    expect(note()).toBeNull();
    expect(prompt()).toBeNull();
  });

  it("says so in a toast when recommendations hide during a video", () => {
    history.replaceState(null, "", "/watch?v=abc");
    makeMasthead();
    initHiddenFeed("watch");
    toggle().click();
    vi.advanceTimersByTime(PEEK_MS);
    expect(document.querySelector(".ythc-toast")?.textContent).toMatch(/hidden again/);
  });
});
