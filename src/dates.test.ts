import { describe, it, expect } from "vitest";
import { parseSectionDate, daysAgo } from "./dates.js";

const NOW = new Date("2026-06-06T12:00:00Z");

describe("parseSectionDate", () => {
  it("parses 'Today' as the current day", () => {
    const d = parseSectionDate("Today", NOW)!;
    expect(daysAgo(d, NOW)).toBe(0);
  });

  it("parses 'Yesterday' as one day ago", () => {
    const d = parseSectionDate("Yesterday", NOW)!;
    expect(daysAgo(d, NOW)).toBe(1);
  });

  it("is case-insensitive on Today/Yesterday", () => {
    expect(parseSectionDate("today", NOW)).not.toBeNull();
    expect(parseSectionDate("YESTERDAY", NOW)).not.toBeNull();
  });

  it("parses 'May 30' against current year", () => {
    const d = parseSectionDate("May 30", NOW)!;
    expect(d.getMonth()).toBe(4);
    expect(d.getDate()).toBe(30);
    expect(d.getFullYear()).toBe(2026);
  });

  it("parses 'Jan 4, 2025' with explicit year", () => {
    const d = parseSectionDate("Jan 4, 2025", NOW)!;
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(4);
    expect(d.getFullYear()).toBe(2025);
  });

  it("parses full month names", () => {
    const d = parseSectionDate("January 4, 2025", NOW)!;
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(4);
  });

  it("backtracks one year when month is in the future relative to now", () => {
    // NOW = 2026-06-06. "Dec 25" is later in the calendar than June → must
    // refer to Dec 25, 2025, not Dec 25, 2026.
    const d = parseSectionDate("Dec 25", NOW)!;
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(25);
  });

  it("returns null on unrecognized format", () => {
    expect(parseSectionDate("Earlier this month", NOW)).toBeNull();
    expect(parseSectionDate("Last week", NOW)).toBeNull();
    expect(parseSectionDate("Foobar", NOW)).toBeNull();
    expect(parseSectionDate("", NOW)).toBeNull();
  });

  it("returns null on invalid day of month", () => {
    expect(parseSectionDate("Feb 32", NOW)).toBeNull();
    expect(parseSectionDate("Mar 0", NOW)).toBeNull();
  });
});

describe("daysAgo", () => {
  it("returns 0 for today", () => {
    expect(daysAgo(new Date("2026-06-06T08:00:00Z"), NOW)).toBe(0);
  });

  it("returns 7 for one week ago", () => {
    expect(daysAgo(new Date("2026-05-30T12:00:00Z"), NOW)).toBe(7);
  });

  it("returns 365 for one year ago", () => {
    const oneYearAgo = new Date(NOW);
    oneYearAgo.setFullYear(NOW.getFullYear() - 1);
    expect(daysAgo(oneYearAgo, NOW)).toBe(365);
  });
});
