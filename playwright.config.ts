import { defineConfig, devices } from "@playwright/test";

/**
 * Cross-engine visual/regression config + integration tests.
 * Assumes the dev server is already running on http://localhost:8080.
 *
 *   bun run test:visual                       # all projects
 *   bun run test:visual --project=chromium    # visual only, chromium
 *   bun run test:visual --project=integration # integration tests
 *   bun run test:visual:update                # refresh baselines
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  expect: { timeout: 5_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:8080",
    trace: "off",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      testMatch: /visual\/.*\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          executablePath:
            process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "/chromium-1194/chrome-linux/chrome",
        },
      },
    },
    {
      name: "firefox",
      testMatch: /visual\/.*\.spec\.ts$/,
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          executablePath:
            process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE || "/firefox-1495/firefox/firefox",
        },
      },
    },
    {
      name: "webkit",
      testMatch: /visual\/.*\.spec\.ts$/,
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          executablePath:
            process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE || "/webkit-2215/pw_run.sh",
        },
      },
    },
    {
      name: "integration",
      testMatch: /integration\/.*\.spec\.ts$|e2e\/.*\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
          : process.env.CI
            ? {}
            : { executablePath: "/chromium-1194/chrome-linux/chrome" },
      },
    },
    // Cross-browser deep-link coverage. These projects re-run the deep-link
    // suites (suggestion-event + expired-session) against Firefox and WebKit
    // to catch engine-specific regressions in event dispatch, hydration,
    // storage restoration and navigation.
    {
      name: "deep-links-chromium",
      testMatch: /integration\/(suggestion-event-deep-links|expired-session-deep-link)\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          executablePath:
            process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "/chromium-1194/chrome-linux/chrome",
        },
      },
    },
    {
      name: "deep-links-firefox",
      testMatch: /integration\/(suggestion-event-deep-links|expired-session-deep-link)\.spec\.ts$/,
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          executablePath:
            process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE || "/firefox-1495/firefox/firefox",
        },
      },
    },
    {
      name: "deep-links-webkit",
      testMatch: /integration\/(suggestion-event-deep-links|expired-session-deep-link)\.spec\.ts$/,
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          executablePath:
            process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE || "/webkit-2215/pw_run.sh",
        },
      },
    },

  ],
});

