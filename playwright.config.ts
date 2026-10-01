import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a seeded database (`pnpm db:seed --reset`) and a running app.
 * BASE_URL defaults to the local dev server. CHROME_PATH can point to a preinstalled Chromium.
 */
const launchOptions = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};

export default defineConfig({
  testDir: "e2e/specs",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure", launchOptions },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
});
