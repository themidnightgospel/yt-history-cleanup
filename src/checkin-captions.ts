// Captions for the `watch check-in` meme: top text, a character, bottom
// text. `minutes` is the whole minutes of this video played so far. A
// caption with `minMinutes` is only used once that much has been watched,
// so "40 minutes later" never shows at minute 1. `onResume` captions only
// fit the check-in shown when you come back from a pause of your own.

export type CaptionContext = { minutes: number };

export type Caption = {
  top: (c: CaptionContext) => string;
  face: string;
  bottom: (c: CaptionContext) => string;
  minMinutes?: number;
  onResume?: boolean;
};

const text = (s: string) => (): string => s;
const mins = (n: number): string => `${n} minute${n === 1 ? "" : "s"}`;

export const CAPTIONS: readonly Caption[] = [
  { top: text("Watching on purpose"), face: "🧟", bottom: text("Or zombie mode?") },
  { top: text("Autoplay chose this"), face: "🤖", bottom: text("Did you?") },
  { top: text("Is this what you opened YouTube for?"), face: "🧐", bottom: text("Be honest") },
  { top: text("Would you search for this?"), face: "🔍", bottom: text("Or did it find you?") },
  { top: text("Brain: we should do something"), face: "🧠", bottom: text("Thumb: one more video") },
  { top: text("Plot twist"), face: "🎬", bottom: text("You can just close it") },
  { top: text("Future you is watching"), face: "👀", bottom: text("And taking notes") },
  { top: text("Your to-do list called"), face: "📋", bottom: text("It misses you") },
  { top: text("This video is fine"), face: "🐶", bottom: text("But is it what you came for?") },
  { top: text("Hey, you"), face: "👋", bottom: text("Still here on purpose?") },
  {
    top: text("Me: one quick video"),
    face: "🐢",
    bottom: (c) => `Also me, ${mins(c.minutes)} later`,
    minMinutes: 5,
  },
  {
    top: (c) => `${mins(c.minutes)} in`,
    face: "🫠",
    bottom: text("Still learning, or just still here?"),
    minMinutes: 5,
  },
  {
    top: text("Nobody:"),
    face: "🙃",
    bottom: (c) => `You, ${mins(c.minutes)} into this`,
    minMinutes: 10,
  },
  { top: text("You paused for a sec"), face: "🤔", bottom: text("Was it worth coming back?"), onResume: true },
  { top: text("You stepped away"), face: "🚶", bottom: text("Coming back on purpose?"), onResume: true },
];

/** Captions that fit this check-in. Never empty: the general ones always fit. */
export function eligibleCaptions(c: CaptionContext, onResume: boolean): Caption[] {
  return CAPTIONS.filter(
    (cap) => (cap.onResume ?? false) === onResume && c.minutes >= (cap.minMinutes ?? 0),
  );
}

/**
 * Picks a caption at random without repeating one until every eligible
 * caption has been used. `used` is the caller's memory of shown captions.
 */
export function pickCaption(
  c: CaptionContext,
  onResume: boolean,
  used: Set<Caption>,
  random: () => number = Math.random,
): Caption {
  let pool = eligibleCaptions(c, onResume);
  if (pool.length === 0) pool = eligibleCaptions(c, false);
  let fresh = pool.filter((cap) => !used.has(cap));
  if (fresh.length === 0) {
    for (const cap of pool) used.delete(cap);
    fresh = pool;
  }
  const cap = fresh[Math.floor(random() * fresh.length)] ?? fresh[0]!;
  used.add(cap);
  return cap;
}
