import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      reporter: ["text", "json", "html"],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 95,
        lines: 90,
      },
    },
    include: ["packages/*/test/**/*.test.ts"],
  },
});
