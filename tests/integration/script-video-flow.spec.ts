import { expect, test } from "@playwright/test";
import { prepareAppUi, AUDIT_WORKSPACE } from "../fixtures/app-ui";
import {
  CreateProjectBody,
  ProductSchema,
  type ModelView,
  type ProjectView,
} from "../../src/lib/ugc/schemas";

test("script review offers only the relevant video paths and carries its complete snapshot", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await prepareAppUi(page, "light");
  await page.goto("/studio-lab?scene=review-script&device=phone");
  await expect(page.locator('[data-ready="true"]')).toBeVisible({ timeout: 60_000 });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await expect(page.getByText("Needs your approval", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Make video", exact: true }).click();
  await expect(page.getByRole("button", { name: /Creator video · UGC/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Visual video Bring/ })).toBeVisible();
  await page.evaluate(() => {
    window.addEventListener("open:ugc-studio", (event) => {
      sessionStorage.setItem("ugc-handoff", JSON.stringify((event as CustomEvent).detail));
    });
  });
  await page.getByRole("button", { name: /Creator video · UGC/ }).click();
  const handoff = await page.evaluate(() => JSON.parse(sessionStorage.getItem("ugc-handoff")!));
  expect(handoff.source.script.beats).toHaveLength(4);
  expect(handoff.source.script.beats[3].voiceover).toBe("Get our grind chart free — link in bio.");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Make video", exact: true }).click();
  // Give the store the canonical workspace URL used by the production shell.
  await page.evaluate(() =>
    history.replaceState(null, "", "/w/00000000-0000-4000-8000-000000000000/app"),
  );
  await page.getByRole("button", { name: /Visual video Bring/ }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("studio:sessions:v2")!));
  expect(stored.sessions[0].type).toBe("video");
  expect(stored.sessions[0].sourceScript).toEqual(handoff.source.script);
  expect(stored.sessions[0].controls.durationSec).toBe(30);
  await page.goto("/studio-lab?scene=brief-script-video&device=phone");
  await expect(page.getByRole("heading", { name: "Make your video", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Write it for me", exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Goal", exact: true })).toHaveCount(0);
  await page.getByText("Script used in this video", { exact: true }).click();
  await expect(
    page.getByText("Get our grind chart free — link in bio.", { exact: false }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("reviewed-script-video-mobile.png"),
    fullPage: true,
  });
});

test("creator handoff saves the supplied script, skips ideas, and renders that project", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await prepareAppUi(page, "light");
  const model: ModelView = {
    key: "long",
    displayName: "Creator video",
    tier: "standard",
    description: "Creator video",
    durations: [10, 15, 30, 60],
    imageDurations: null,
    nativeDurations: [10],
    aspectRatios: ["9:16", "1:1", "16:9"],
    resolutions: ["720p", "1080p"],
    defaultResolution: "720p",
    nativeAudio: true,
    images: null,
    videoUnits: 1,
  };
  let project: ProjectView | null = null;
  const renders: Record<string, unknown>[] = [];
  let conceptCalls = 0;
  await page.route("**/api/ugc/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/models"))
      return route.fulfill({
        json: {
          models: [model],
          defaultModel: "long",
          allowance: {
            plan: "agency",
            videos: { used: 0, held: 0, limit: 100 },
            activeRenders: 0,
            maxConcurrent: 3,
          },
        },
      });
    if (path.endsWith("/extract"))
      return route.fulfill({
        json: {
          product: ProductSchema.parse({
            name: "Daily moisturiser",
            description: "Made without fragrance.",
          }),
          analyzed: true,
        },
      });
    if (path.endsWith("/concepts")) {
      conceptCalls++;
      return route.fulfill({ status: 500, json: { error: "A new script must not be generated" } });
    }
    if (path === "/api/ugc/projects" && route.request().method() === "POST") {
      const input = CreateProjectBody.parse(route.request().postDataJSON());
      project = {
        id: "00000000-0000-4000-8000-000000000099",
        title: input.title ?? input.product.name,
        productUrl: null,
        product: input.product,
        brief: input.brief,
        script: input.script ?? null,
        concepts: [],
        selectedConceptId: null,
        references: [],
        renders: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return route.fulfill({ json: { project } });
    }
    if (path.startsWith("/api/ugc/projects/")) return route.fulfill({ json: { project } });
    if (path === "/api/ugc/renders") {
      renders.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          render: {
            id: "render-fixture",
            projectId: project!.id,
            status: "processing",
            model: "long",
            modelName: "Creator video",
            durationSec: 10,
            aspectRatio: "9:16",
            resolution: "720p",
            hook: project!.script!.hook,
            createdAt: new Date().toISOString(),
            videoUrl: null,
          },
        },
      });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/layout-lab?scene=ugc-script-video");
  await expect(page.getByRole("textbox", { name: "Product page link" })).toBeVisible({
    timeout: 60_000,
  });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await expect(page.getByRole("button", { name: "Idea", exact: true })).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Product page link" })
    .fill("https://example.test/product");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("button", { name: "Create video", exact: true })).toBeVisible();
  expect(project!.brief.scriptSource).toBe("studio");
  expect(project!.brief.platform).toBe("reels");
  expect(project!.script!.scenes.map((scene) => scene.dialogue)).toEqual([
    "Keep your routine simple.",
    "See the moisturiser today.",
  ]);
  expect(conceptCalls).toBe(0);
  await page.getByRole("button", { name: /Script used in this video/ }).click();
  await expect(page.getByText("See the moisturiser today.", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("creator-script-video-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Create video", exact: true }).click();
  await expect.poll(() => renders.length).toBe(1);
  expect(renders[0]).toMatchObject({
    workspaceId: AUDIT_WORKSPACE,
    projectId: project!.id,
    durationSec: 10,
  });
  expect(conceptCalls).toBe(0);
});
