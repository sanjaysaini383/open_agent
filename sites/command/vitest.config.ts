import { defineConfig } from "vitest/config";

// Unit tests cover the pure domain modules, which need no DOM.
export default defineConfig({
  resolve: { alias: { "@": "/src" } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
