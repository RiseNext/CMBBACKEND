import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/tests/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 90_000,
    // PGlite instances are per-file; running files sequentially keeps memory
    // predictable inside a small container.
    fileParallelism: false,
  },
});
