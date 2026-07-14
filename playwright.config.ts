import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/quality",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  // PIXI graph pages compete for Chromium's shared WebGL contexts when this single spec runs in parallel.
  workers: 1,
  reporter: [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    browserName: "chromium",
    headless: true,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node scripts/quality/serve-static.mjs public 4173",
      url: "http://127.0.0.1:4173/",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "node scripts/quality/serve-static.mjs public-notes 4174",
      url: "http://127.0.0.1:4174/",
      reuseExistingServer: !process.env.CI,
    },
  ],
})
