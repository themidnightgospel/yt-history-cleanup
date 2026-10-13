import { describe, it, expect, beforeEach, vi } from "vitest";
import { videoOf, playerFeature } from "./player.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("videoOf", () => {
  it("prefers YouTube's main video over any <video> that comes before it", () => {
    const p = document.createElement("div");
    const other = document.createElement("video");
    const main = document.createElement("video");
    main.className = "html5-main-video";
    p.append(other, main);
    expect(videoOf(p)).toBe(main);
  });

  it("falls back to any <video>", () => {
    const p = document.createElement("div");
    const only = document.createElement("video");
    p.appendChild(only);
    expect(videoOf(p)).toBe(only);
  });
});

describe("playerFeature", () => {
  it("stops waiting when ensure throws instead of rethrowing on every mutation", async () => {
    let calls = 0;
    let ready = false;
    const ensure = vi.fn(() => {
      calls++;
      if (ready) throw new Error("broken feature");
      return false;
    });
    // Errors thrown in an observer callback are reported, not propagated.
    const onError = vi.fn((e: ErrorEvent) => e.preventDefault());
    window.addEventListener("error", onError);
    playerFeature(ensure)(true);
    expect(calls).toBe(1);

    ready = true;
    document.body.appendChild(document.createElement("div"));
    await vi.waitFor(() => expect(calls).toBe(2));
    document.body.appendChild(document.createElement("div"));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(2);
    window.removeEventListener("error", onError);
  });
});
