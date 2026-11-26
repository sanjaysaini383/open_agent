// End-to-end tests drive the five sites in a real browser. The sites must be built and
// are served by the official serve_site.mjs, each on its own origin (npm run serve).
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "*.spec.mjs",
  outputDir: "test-results",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    // The system's Chrome, so nothing needs downloading. Set PW_CHANNEL=msedge for Edge.
    channel: process.env.PW_CHANNEL || "chrome",
    headless: true,
    viewport: { width: 1500, height: 950 },
    baseURL: process.env.RELIEFMESH_COMMAND || "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node scripts/serve-all.mjs",
    url: "http://localhost:8084/agent-manifest.json",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
