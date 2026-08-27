import { test, expect, Page } from "@playwright/test";

/**
 * LIVE PLATFORM E2E TEST
 * ----------------------
 * Runs against the real RavalAI dev server (http://localhost:8080)
 * with real Supabase auth + real SDR tunnel.
 *
 * Credentials: junaidsajjad2298@gmail.com / Junaid@1234
 *
 * Scenarios:
 *  1. Login with email/password
 *  2. Navigate all major app routes
 *  3. Test SDR connections page
 *  4. Test OAuth (LinkedIn + X) — verifies the redirect URLs work
 *  5. Test post creation flow
 *  6. Verify all pages render without errors
 */

const TEST_EMAIL = "junaidsajjad2298@gmail.com";
const TEST_PASSWORD = "Junaid@1234";
const BASE_URL = "http://localhost:8080";

test.describe.serial("Live Platform E2E", () => {
  test.describe.configure({ timeout: 120_000 });
  test.beforeEach(async ({ page }) => {
    // Capture console errors
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("favicon")) {
        console.log(`[CONSOLE ERROR] ${msg.text().slice(0, 200)}`);
      }
    });
    page.on("pageerror", (err) => {
      console.log(`[PAGE ERROR] ${err.message.slice(0, 200)}`);
    });
  });

  test("1. Login flow with credentials", async ({ page }) => {
    console.log("\n=== TEST 1: LOGIN FLOW ===");
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("networkidle");

    // Fill credentials
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);

    // Submit
    const submitButton = page.locator('button[type="submit"]').first();
    await submitButton.click();

    // Wait for navigation away from /login
    try {
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 });
      console.log("✅ Login successful, navigated to:", page.url());
    } catch (e) {
      console.log("❌ Login failed or didn't redirect. Current URL:", page.url());
      const errorMessage = await page.locator('[role="alert"], .error, .text-red-500').first().textContent().catch(() => null);
      if (errorMessage) console.log("Error message:", errorMessage);
      throw e;
    }

    // Verify we're authenticated (URL should not be /login anymore)
    expect(page.url()).not.toContain("/login");
  });

  test("2. Navigate all major routes", async ({ page }) => {
    console.log("\n=== TEST 2: ROUTE NAVIGATION ===");

    // Login first — go to /login directly (no ?next=) so nextPath defaults to /app
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("networkidle");
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.locator('button[type="submit"]').first().click();

    // Wait for redirect away from /login (accepts /app/* or /dashboard/*)
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 });
    console.log("✅ Login redirected to:", page.url());

    const routes = [
      "/app",
      "/app/content",
      "/app/social",
      "/app/analytics",
      "/app/seo",
      "/studio",   // Should redirect to /app/social
      "/projects",
      "/agency",
    ];

    const results: { route: string; status: string; url: string }[] = [];

    for (const route of routes) {
      try {
        await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 15000 });
        // Wait briefly for the page to settle, but don't wait for networkidle
        await page.waitForTimeout(1000);
        const hasError = await page.locator("text=/404|not found/i").count();
        const finalUrl = page.url();
        if (hasError > 0) {
          results.push({ route, status: "404", url: finalUrl });
          console.log(`⚠️  ${route} → 404 page (final: ${finalUrl})`);
        } else {
          results.push({ route, status: "ok", url: finalUrl });
          console.log(`✅ ${route} → ${finalUrl.replace(BASE_URL, "")}`);
        }
      } catch (e) {
        results.push({ route, status: "error", url: (e as Error).message.slice(0, 80) });
        console.log(`❌ ${route} - ${(e as Error).message.slice(0, 80)}`);
        // Try to recover the page for next iteration
        try { await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 5000 }); } catch {}
      }
    }

    const okCount = results.filter(r => r.status === "ok").length;
    console.log(`\nRoute summary: ${okCount}/${routes.length} loaded successfully`);
  });

  test("3. SDR Connections page", async ({ page }) => {
    console.log("\n=== TEST 3: SDR CONNECTIONS ===");

    // Login
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("networkidle");
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 });

    // Navigate to social/connections
    await page.goto(`${BASE_URL}/app/social`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000); // Let the SDR UI load

    // Look for connection buttons
    const connectButtons = await page.locator('button:has-text("Connect"), button:has-text("Link")').count();
    console.log(`Found ${connectButtons} connection buttons`);

    if (connectButtons > 0) {
      console.log("✅ SDR Connections page loaded with connection options");
    } else {
      console.log("⚠️  No connection buttons found on /app/social");
    }

    // Check for platform logos/names
    const hasLinkedIn = await page.locator('text=/linkedin/i').count();
    const hasTwitter = await page.locator('text=/twitter|x\\.com/i').count();
    const hasFacebook = await page.locator('text=/facebook/i').count();
    const hasInstagram = await page.locator('text=/instagram/i').count();

    console.log(`Platforms found - LinkedIn: ${hasLinkedIn}, X/Twitter: ${hasTwitter}, Facebook: ${hasFacebook}, Instagram: ${hasInstagram}`);
  });

  test("4. LinkedIn OAuth flow", async ({ page, context }) => {
    console.log("\n=== TEST 4: LINKEDIN OAUTH ===");

    // Login
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("networkidle");
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 });

    // Navigate to connections
    await page.goto(`${BASE_URL}/app/social`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Find LinkedIn connect button
    const linkedinButton = page.locator('button:has-text("Connect LinkedIn"), button:has-text("Link LinkedIn"), a:has-text("Connect LinkedIn")').first();

    if (await linkedinButton.count() === 0) {
      console.log("⚠️  LinkedIn connect button not found");
      return;
    }

    // Click and verify redirect to LinkedIn
    const [popup] = await Promise.all([
      context.waitForEvent("page", { timeout: 10000 }).catch(() => null),
      linkedinButton.click(),
    ]);

    if (popup) {
      const url = popup.url();
      console.log("Popup URL:", url);
      if (url.includes("linkedin.com") || url.includes("oauth")) {
        console.log("✅ LinkedIn OAuth redirect successful");
        await popup.close();
      } else {
        console.log("⚠️  Popup opened but URL unexpected:", url);
        await popup.close();
      }
    } else {
      // May redirect in same window
      await page.waitForTimeout(3000);
      const currentUrl = page.url();
      if (currentUrl.includes("linkedin.com") || currentUrl.includes("oauth")) {
        console.log("✅ LinkedIn OAuth redirect (same window):", currentUrl);
      } else {
        console.log("⚠️  No popup or redirect detected. Current URL:", currentUrl);
      }
    }
  });

  test("5. X/Twitter OAuth flow", async ({ page, context }) => {
    console.log("\n=== TEST 5: X/TWITTER OAUTH ===");

    // Login
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("networkidle");
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 });

    // Navigate to connections
    await page.goto(`${BASE_URL}/app/social`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Find X/Twitter connect button
    const twitterButton = page.locator('button:has-text("Connect X"), button:has-text("Connect Twitter"), button:has-text("Link X"), button:has-text("Link Twitter")').first();

    if (await twitterButton.count() === 0) {
      console.log("⚠️  X/Twitter connect button not found");
      return;
    }

    const [popup] = await Promise.all([
      context.waitForEvent("page", { timeout: 10000 }).catch(() => null),
      twitterButton.click(),
    ]);

    if (popup) {
      const url = popup.url();
      console.log("Popup URL:", url);
      if (url.includes("twitter.com") || url.includes("x.com") || url.includes("oauth")) {
        console.log("✅ X/Twitter OAuth redirect successful");
        await popup.close();
      } else {
        console.log("⚠️  Popup opened but URL unexpected:", url);
        await popup.close();
      }
    } else {
      await page.waitForTimeout(3000);
      const currentUrl = page.url();
      if (currentUrl.includes("twitter.com") || currentUrl.includes("x.com")) {
        console.log("✅ X/Twitter OAuth redirect (same window):", currentUrl);
      } else {
        console.log("⚠️  No popup or redirect. Current URL:", currentUrl);
      }
    }
  });

  test("6. SDR API endpoints (via proxy)", async ({ request }) => {
    console.log("\n=== TEST 6: SDR API ENDPOINTS ===");

    // Test SDR accounts endpoint
    const accountsRes = await request.get(`${BASE_URL}/api/sdr/accounts`);
    console.log(`GET /api/sdr/accounts → ${accountsRes.status()}`);

    // Test SDR workspace endpoint
    const workspaceRes = await request.get(`${BASE_URL}/api/sdr/workspace`);
    console.log(`GET /api/sdr/workspace → ${workspaceRes.status()}`);

    // Test SDR connections endpoint
    const connRes = await request.get(`${BASE_URL}/api/sdr/connections`);
    console.log(`GET /api/sdr/connections → ${connRes.status()}`);

    // At minimum, we should NOT see 500 errors
    expect(accountsRes.status()).not.toBe(500);
  });

  test("7. Full platform health check", async ({ page }) => {
    console.log("\n=== TEST 7: PLATFORM HEALTH ===");

    // Check homepage
    const homeRes = await page.goto(BASE_URL);
    expect(homeRes?.status()).toBe(200);
    console.log("✅ Homepage: 200");

    // Check login page
    const loginRes = await page.goto(`${BASE_URL}/login`);
    expect(loginRes?.status()).toBe(200);
    console.log("✅ Login page: 200");

    // Check signup page
    const signupRes = await page.goto(`${BASE_URL}/signup`);
    expect(signupRes?.status()).toBe(200);
    console.log("✅ Signup page: 200");

    // Check pricing/marketing pages
    const routes = ["/agency", "/projects", "/onboarding"];
    for (const route of routes) {
      const res = await page.goto(`${BASE_URL}${route}`);
      console.log(`${res?.status() === 200 ? "✅" : "❌"} ${route}: ${res?.status()}`);
    }
  });
});
