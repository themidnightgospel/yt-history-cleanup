import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: here,
  testMatch: ["*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    headless: true,
  },
  outputDir: resolve(here, "test-results"),
});
