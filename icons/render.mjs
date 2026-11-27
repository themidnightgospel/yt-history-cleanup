// Renders icons/icon.svg (and icon-16.svg for 16px) to the PNG sizes the manifest lists.
// Run: node icons/render.mjs
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const svgs = {
  big: await readFile(join(here, "icon.svg"), "utf8"),
  // 16px gets its own drawing on the pixel grid; the big one blurs at that size.
  small: await readFile(join(here, "icon-16.svg"), "utf8"),
};
const browser = await chromium.launch();
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${size === 16 ? svgs.small : svgs.big}`,
  );
  await page.screenshot({ path: join(here, `icon-${size}.png`), omitBackground: true });
  await page.close();
  console.log(`icon-${size}.png`);
}
await browser.close();
