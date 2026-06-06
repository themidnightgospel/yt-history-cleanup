const MONTHS_LONG = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const MONTHS_SHORT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Parses YouTube's English watch-history section headers:
//   "Today" / "Yesterday" / "May 30" / "Jan 4, 2025"
// Returns the section's date at noon (TZ-stable). Returns null on
// unrecognized input — caller decides whether to skip the row.
export function parseSectionDate(title: string, now: Date): Date | null {
  const trimmed = title.trim();
  const lower = trimmed.toLowerCase();

  if (lower === "today") return atNoon(now);
  if (lower === "yesterday") {
    return atNoon(new Date(now.getTime() - MS_PER_DAY));
  }

  // "Jan 4, 2025" or "Jan 4" or "January 4, 2025" or "January 4"
  const match = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (!match) return null;
  const monthIdx = monthIndex(match[1]!);
  if (monthIdx < 0) return null;
  const day = Number(match[2]!);
  if (day < 1 || day > 31) return null;

  if (match[3]) {
    return atNoon(new Date(Number(match[3]), monthIdx, day));
  }

  // No year given. Default to current year; if that puts the date in the
  // future relative to `now`, fall back one year (YT omits the year only
  // for the current year's entries).
  const candidate = new Date(now.getFullYear(), monthIdx, day);
  if (candidate.getTime() > now.getTime()) {
    candidate.setFullYear(candidate.getFullYear() - 1);
  }
  return atNoon(candidate);
}

export function daysAgo(date: Date, now: Date): number {
  const start = atNoon(date).getTime();
  const today = atNoon(now).getTime();
  return Math.round((today - start) / MS_PER_DAY);
}

function atNoon(d: Date): Date {
  const copy = new Date(d.getTime());
  copy.setHours(12, 0, 0, 0);
  return copy;
}

function monthIndex(name: string): number {
  const lower = name.toLowerCase();
  const long = MONTHS_LONG.indexOf(lower);
  if (long >= 0) return long;
  return MONTHS_SHORT.indexOf(lower);
}
