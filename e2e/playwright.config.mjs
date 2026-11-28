import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3100);
// A browser already on the machine (E2E_BROWSER=msedge or chrome) instead of Playwright's own.
const channel = process.env.E2E_BROWSER;

export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], channel, viewport: { width: 1360, height: 900 } },
    },
    { name: "phone", use: { ...devices["Pixel 7"], channel } },
  ],
  // The production build (npm run build first), as it is deployed.
  webServer: {
    command: `npx next start -H 127.0.0.1 -p ${port}`,
    cwd: "..",
    url: `http://127.0.0.1:${port}/discover`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
