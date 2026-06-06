// Reads a captured YouTube history page (HTML with `var ytInitialData = {...}`
// inline) or a raw ytInitialData JSON file, extracts every
// {feedbackToken, videoId} pair, replaces both with synthetic counters, and
// writes the minimal fixture consumed by the canary test.
//
// Usage:
//   node scripts/scrub-captured.mjs <input> <output>
//
// Example:
//   node scripts/scrub-captured.mjs ../test.html tests/fixtures/captured-history.json

import { readFileSync, writeFileSync } from "node:fs";

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error("usage: node scripts/scrub-captured.mjs <input> <output>");
  process.exit(1);
}

const raw = readFileSync(inputPath, "utf8");
const root = raw.trimStart().startsWith("{") ? JSON.parse(raw) : extractYtInitialData(raw);

const seen = new Set();
const triples = [];
const stack = [root];
while (stack.length) {
  const node = stack.pop();
  if (!node || typeof node !== "object") continue;
  if (typeof node.feedbackToken === "string" && Array.isArray(node.actions)) {
    let videoId = null;
    for (const action of node.actions) {
      if (!action || typeof action !== "object") continue;
      const vid =
        action.hideItemSectionVideosByIdCommand?.videoId ??
        action.localWatchHistoryCommand?.videoId;
      if (vid) {
        videoId = vid;
        break;
      }
    }
    if (videoId && !seen.has(videoId)) {
      seen.add(videoId);
      const n = String(triples.length + 1).padStart(4, "0");
      triples.push({
        feedbackToken: `synthToken_${n}`,
        actions: [{ hideItemSectionVideosByIdCommand: { videoId: `synthVid_${n}` } }],
      });
    }
  }
  if (Array.isArray(node)) for (const c of node) stack.push(c);
  else for (const k in node) stack.push(node[k]);
}

const out = {
  _scrubbed:
    "Synthetic tokens + videoIds. Personal data fully replaced; shape preserved so the canary test still exercises the walker over a realistic-looking, multi-entry payload.",
  triples,
};
writeFileSync(outputPath, JSON.stringify(out, null, 2));
console.log(`wrote ${triples.length} triples to ${outputPath}`);

function extractYtInitialData(html) {
  const m = html.match(/var ytInitialData = (\{[\s\S]*?\});\s*<\/script>/);
  if (!m) throw new Error("ytInitialData not found in HTML input");
  return JSON.parse(m[1]);
}
