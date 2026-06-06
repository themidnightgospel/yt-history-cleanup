import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: { url: "https://www.youtube.com/feed/history" },
    },
    include: ["src/**/*.test.ts"],
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/entry.ts", "src/globals.d.ts"],
      thresholds: {
        lines: 60,
        functions: 60,
        statements: 60,
        branches: 50,
      },
    },
  },
});
