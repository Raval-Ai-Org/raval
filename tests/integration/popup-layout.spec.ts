import { expect, test, type Locator, type Page } from "@playwright/test";
import { FEATURES } from "../../src/lib/billing/catalog";
import { prepareAppUi } from "../fixtures/app-ui";
import { SUPABASE_HOST } from "../fixtures/supabase-ref";

test.setTimeout(120_000);

async function fixtures(page: Page) {
  await prepareAppUi(page, "light");
  await page.context().route("**/api/billing/entitlements**", async (route) => {
    await route.fulfill({
      json: {
        isOwner: true,
        entitledPlan: "free",
        plan: "free",
        status: "active",
        features: Object.fromEntries(
          Object.entries(FEATURES).map(([key, feature]) => [
            key,
            {
              allowed: feature.minPlan === "free",
              requiredPlan: feature.minPlan,
            },
          ]),
        ),
        meters: { credits: { available: 300, held: 0, debt: 0, nextExpiry: null } },
      },
    });
  });
  await page
    .context()
    .route(`https://${SUPABASE_HOST}/rest/v1/workspaces**`, (route) =>
      route.fulfill({ json: { owner_id: "00000000-0000-4000-8000-000000000002" } }),
    );
  await page.context().route(`https://${SUPABASE_HOST}/rest/v1/workspace_invites**`, (route) =>
    route.fulfill({
      headers: { "content-range": "0-0/1" },
      json: [
        {
          id: "invite-1",
          email: "averylongteammateemailaddress@gmail.com",
          role: "editor",
          token: "fixture",
        },
      ],
    }),
  );
  await page.context().route("**/api/rpc/workspaces/getWorkspaceMemberProfiles", (route) =>
    route.fulfill({
      json: {
        result: {
          total: 12,
          pageSize: 10,
          currentRole: "owner",
          members: Array.from({ length: 10 }, (_, i) => ({
            user_id: `member-${i}`,
            role: "editor",
            name: "A teammate with a very long display name",
            email: "averylongteammateemailaddress@gmail.com",
            avatar_url: null,
          })),
        },
      },
    }),
  );
  await page.context().route("**/api/rpc/brain/getBrainOverview", (route) =>
    route.fulfill({
      json: {
        result: {
          brains: Object.fromEntries(
            ["brand", "audience", "competitors", "market"].map((id) => [
              id,
              {
                ready: false,
                enabled: true,
                health: 0,
                headline: "Get started",
                updatedAt: null,
                facts: [],
              },
            ]),
          ),
          strategy: {
            status: null,
            stale: false,
            updatedAt: null,
            pillars: [],
            headline: "Create a strategy",
          },
          updates: [],
          needs: [],
          generatedAt: new Date().toISOString(),
        },
      },
    }),
  );
  await page.context().route("**/api/rpc/competitors/getCompetitorOverview", (route) =>
    route.fulfill({
      json: {
        result: {
          competitors: [],
          suggestions: [],
          updates: [],
          unreadUpdates: 0,
          researchAvailable: true,
          lastDiscoveryAt: new Date().toISOString(),
        },
      },
    }),
  );
}

async function openScene(page: Page, scene: string) {
  await page.goto(`/layout-lab?scene=${scene}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("layout-lab")).toHaveAttribute("data-ready", "true", {
    timeout: 90_000,
  });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

async function fitsHorizontally(container: Locator) {
  await expect
    .poll(() =>
      container.evaluate((root) => {
        const bounds = root.getBoundingClientRect();
        return Array.from(root.querySelectorAll<HTMLElement>("button, input, [role=img]")).flatMap(
          (el) => {
            const rect = el.getBoundingClientRect();
            if (!rect.width || !rect.height) return [];
            for (
              let parent = el.parentElement;
              parent && parent !== root;
              parent = parent.parentElement
            ) {
              const style = getComputedStyle(parent);
              if (style.overflowX === "auto" || style.overflowX === "scroll") return [];
            }
            return rect.left < bounds.left - 2 || rect.right > bounds.right + 2
              ? [el.getAttribute("aria-label") || el.textContent?.trim()]
              : [];
          },
        );
      }),
    )
    .toEqual([]);
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 667, height: 375 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
]) {
  test.describe(`popup layout ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });
    test.beforeEach(async ({ page }) => fixtures(page));

    test("team email and role align; long member rows and pagination remain reachable", async ({
      page,
    }) => {
      await openScene(page, "share");
      await page.getByRole("button", { name: "Share with team" }).click();
      const dialog = page.getByRole("dialog", { name: "Invite your team" });
      const email = dialog.getByRole("textbox", { name: "Teammate's email" });
      await expect(email).toBeEnabled();
      await email.fill("teammate@gmail.com");
      const role = dialog.getByRole("combobox", { name: "Role", exact: true });
      const invite = dialog.getByRole("button", { name: "Invite", exact: true });
      await expect
        .poll(async () => {
          const a = (await role.boundingBox())!;
          const b = (await invite.boundingBox())!;
          return Math.abs(a.y - b.y);
        })
        .toBeLessThanOrEqual(1);
      if (viewport.width >= 640) {
        const a = (await email.boundingBox())!;
        const b = (await role.boundingBox())!;
        expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
      }
      await fitsHorizontally(dialog);
      await dialog.getByRole("button", { name: "Next", exact: true }).scrollIntoViewIfNeeded();
      await expect(dialog.getByRole("button", { name: "Next", exact: true })).toBeInViewport();
      await expect(dialog.getByRole("button", { name: "Close dialog" })).toBeInViewport();
      await page.screenshot({ path: `test-results/share-${viewport.width}.png` });
    });

    test("Brain's first and last tabs are reachable in its scroll strip", async ({ page }) => {
      await openScene(page, "brain");
      const dialog = page.getByRole("dialog", { name: "Brain", exact: true });
      const tabs = dialog.getByRole("tablist", { name: "Brain", exact: true });
      await expect(tabs.getByRole("tab", { name: "Home", exact: true })).toBeVisible();
      await tabs.evaluate((el) => {
        el.scrollLeft = 0;
      });
      await expect(tabs.getByRole("tab", { name: "Home", exact: true })).toBeInViewport({
        ratio: 0.99,
      });
      await tabs.getByRole("tab", { name: "Strategy", exact: true }).scrollIntoViewIfNeeded();
      await expect(tabs.getByRole("tab", { name: "Strategy", exact: true })).toBeInViewport({
        ratio: 0.99,
      });
      await fitsHorizontally(dialog);
    });

    test("Competitors action and credits stay within the rail and cards", async ({ page }) => {
      await openScene(page, "competitors");
      const dialog = page.getByRole("dialog", { name: "Brain", exact: true });
      const nav = dialog.getByRole("navigation", { name: "Competitors" });
      await expect(nav).toBeVisible();
      await expect(
        dialog
          .getByRole("tablist", { name: "Brain", exact: true })
          .getByRole("tab", { name: "Competitors", exact: true }),
      ).toBeInViewport({ ratio: 0.99 });
      if (viewport.width >= 1024) {
        await fitsHorizontally(nav);
        const action = nav.getByRole("button", { name: /Find competitors/ });
        await expect(action).toBeVisible();
        const overflow = await action.evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(overflow, "Rail action label and credit badge overflow").toBeLessThanOrEqual(1);
        expect(
          await action.evaluate(
            (el) => getComputedStyle(el.querySelector('[data-slot="cost-chip"]')!).color,
          ),
        ).toEqual(await action.evaluate((el) => getComputedStyle(el).color));
      }
      await nav.getByRole("button", { name: "Discover", exact: true }).click();
      await expect(dialog.getByText("Find for me", { exact: true })).toBeVisible();
      await fitsHorizontally(dialog);
      await page.screenshot({ path: `test-results/competitors-${viewport.width}.png` });
    });
  });
}

test("Free plan label and a large credit balance fit the 216px sidebar", async ({ page }) => {
  await fixtures(page);
  await openScene(page, "credits");
  const card = page.getByTestId("free-sidebar-card");
  await expect(card).toBeVisible();
  expect(await card.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  const label = card.getByText("Free plan", { exact: true });
  expect(
    await label.evaluate(
      (el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight),
    ),
  ).toBeLessThanOrEqual(1.01);
});
