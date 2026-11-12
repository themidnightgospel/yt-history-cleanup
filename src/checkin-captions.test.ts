import { describe, it, expect } from "vitest";
import { CAPTIONS, eligibleCaptions, pickCaption, type Caption } from "./checkin-captions.js";

describe("captions", () => {
  it("has about fifteen, each with text on both lines", () => {
    expect(CAPTIONS.length).toBeGreaterThanOrEqual(15);
    for (const c of CAPTIONS) {
      const m = { minutes: c.minMinutes ?? 0 };
      expect(c.top(m).length).toBeGreaterThan(0);
      expect(c.bottom(m).length).toBeGreaterThan(0);
    }
  });

  it("keeps minute-based captions back until that much was watched", () => {
    const early = eligibleCaptions({ minutes: 1 }, false);
    expect(early.every((c) => (c.minMinutes ?? 0) <= 1)).toBe(true);
    const late = eligibleCaptions({ minutes: 20 }, false);
    expect(late.length).toBeGreaterThan(early.length);
  });

  it("uses pause captions only when coming back from a pause", () => {
    expect(eligibleCaptions({ minutes: 3 }, true).every((c) => c.onResume)).toBe(true);
    expect(eligibleCaptions({ minutes: 3 }, false).some((c) => c.onResume)).toBe(false);
  });

  it("fills in the real minutes", () => {
    const later = CAPTIONS.find((c) => c.face === "🐢")!;
    expect(later.bottom({ minutes: 23 })).toBe("Also me, 23 minutes later");
  });

  it("does not repeat a caption until all have been shown", () => {
    const used = new Set<Caption>();
    const pool = eligibleCaptions({ minutes: 1 }, false);
    const seen = new Set<Caption>();
    let r = 0;
    for (let i = 0; i < pool.length; i++) seen.add(pickCaption({ minutes: 1 }, false, used, () => (r = (r + 0.37) % 1)));
    expect(seen.size).toBe(pool.length);
    // The next round starts over.
    expect(pool).toContain(pickCaption({ minutes: 1 }, false, used));
  });
});
