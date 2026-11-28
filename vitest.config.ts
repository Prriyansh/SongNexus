import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    globals: false,
    // Some tests render the whole app in jsdom; beside the rest of the suite on a laptop, one can
    // take several seconds, past the 5 s default.
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // Tests and their helpers aren't measured; data files aren't code.
      exclude: ["src/**/__tests__/**", "src/**/*.json"],
      // Every line and branch is tested; `npm run test:coverage` fails if one isn't.
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
