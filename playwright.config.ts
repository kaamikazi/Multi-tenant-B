import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against a running TenantFlow build and a LOCAL Supabase
// stack (`npx supabase start`). The setup project creates throwaway
// workspaces through the Supabase admin API and signs each user in through
// the real login form. CI: the `e2e` job in .github/workflows/ci.yml.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }], ["github"]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /fixtures\.setup\.ts$/ },
    {
      name: "chromium",
      testMatch: /\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
  // CI starts the production build itself (`npm run build && npm start`) and
  // waits for it; locally this reuses a running server or starts `npm start`
  // (run `npm run build` first).
  webServer: {
    command: "npm start",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  outputDir: "test-results",
});
