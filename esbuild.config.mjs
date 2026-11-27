import * as esbuild from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";

const watch = process.argv.includes("--watch");

async function copyStatic() {
  await mkdir("dist/icons", { recursive: true });
  await copyFile("manifest.json", "dist/manifest.json");
  await copyFile("src/content.css", "dist/content.css");
  for (const size of [16, 32, 48, 128]) {
    await copyFile(`icons/icon-${size}.png`, `dist/icons/icon-${size}.png`);
  }
}

const ctx = await esbuild.context({
  entryPoints: ["src/entry.ts"],
  bundle: true,
  format: "iife",
  target: "chrome120",
  outfile: "dist/content.js",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  logLevel: "info",
});

if (watch) {
  await copyStatic();
  await ctx.watch();
  console.log("watching...");
} else {
  await ctx.rebuild();
  await copyStatic();
  await ctx.dispose();
  console.log("built dist/");
}
