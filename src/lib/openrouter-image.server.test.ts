import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const usage = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("@/server/ai/budget", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/budget")>();
  return { ...actual, enforceBudget: vi.fn(async () => undefined) };
});
vi.mock("@/server/ai/metering", () => ({
  recordUsage: (row: Record<string, unknown>) => usage.rows.push(row),
}));

import { runWithScope } from "@/server/request-context";
import { AiGatewayError } from "./ai-gateway.server";
import { IMAGE_FLARE, IMAGE_SUNBURST } from "./model-router.server";
import {
  aspectRatioFor,
  generateImage,
  imageGenerationStream,
  setImageTransport,
  type ImageRequest,
} from "./openrouter-image.server";

const asUser = <T>(fn: () => Promise<T>) =>
  runWithScope({ userId: crypto.randomUUID(), route: "generate-image" }, fn);

let restore: (() => void) | null = null;
beforeEach(() => {
  usage.rows = [];
});
afterEach(() => {
  restore?.();
  restore = null;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function fakeImages(failFor: Record<string, AiGatewayError> = {}) {
  const calls: ImageRequest[] = [];
  restore = setImageTransport(async (req) => {
    calls.push(req);
    if (failFor[req.model]) throw failFor[req.model];
    return { b64: "iVBORw0KGgo=", mimeType: "image/png", model: req.model, costUsd: 0.021 };
  });
  return calls;
}

describe("OpenRouter image generation", () => {
  it("routes everyday social images to Flare and meters OpenRouter's cost", async () => {
    const calls = fakeImages();
    const image = await asUser(() => generateImage({ prompt: "A tip for a social post" }));
    expect(calls[0]).toMatchObject({ model: IMAGE_FLARE, aspectRatio: "1:1", quality: "medium" });
    expect(image).toMatchObject({ model: IMAGE_FLARE, route: "flare", cached: false });
    expect(usage.rows[0]).toMatchObject({
      provider: "openrouter",
      model: IMAGE_FLARE,
      estCostUsd: 0.021,
    });
  });

  it("routes premium work to Sunburst and falls back to Flare", async () => {
    const calls = fakeImages({
      [IMAGE_SUNBURST]: new AiGatewayError(503, "busy", "provider_error"),
    });
    const image = await asUser(() =>
      generateImage({
        prompt: "Premium product launch campaign poster",
        routing: { requiredQuality: "maximum" },
      }),
    );
    expect(calls.map((c) => c.model)).toEqual([IMAGE_SUNBURST, IMAGE_FLARE]);
    expect(calls[0].quality).toBe("high");
    expect(image.model).toBe(IMAGE_FLARE);
    expect(usage.rows.map((r) => r.status ?? "ok")).toEqual(["error", "ok"]);
  });

  it("stops at a failure another model would repeat (out of credits)", async () => {
    const calls = fakeImages({
      [IMAGE_FLARE]: new AiGatewayError(402, "no credits", "insufficient_credits"),
    });
    await expect(asUser(() => generateImage({ prompt: "A post" }))).rejects.toMatchObject({
      code: "insufficient_credits",
    });
    expect(calls).toHaveLength(1);
  });

  it("edits with up to 4 references and requires one for an edit", async () => {
    const calls = fakeImages();
    const refs = [
      "https://a/1.png",
      "https://a/2.png",
      "https://a/3.png",
      "https://a/4.png",
      "https://a/5.png",
    ];
    await asUser(() =>
      generateImage({
        prompt: "Put the logo on the mug",
        routing: { referenceAssets: refs, editing: true },
      }),
    );
    expect(calls[0].references).toEqual(refs.slice(0, 4));
    await expect(
      asUser(() => generateImage({ prompt: "edit", routing: { editing: true } })),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("maps Studio's 4:5 portrait to the closest supported ratio", () => {
    expect(aspectRatioFor("1024x1280")).toBe("3:4");
    expect(aspectRatioFor("1792x1024")).toBe("16:9");
    expect(aspectRatioFor("1024x1792")).toBe("9:16");
  });

  it("serves a repeat from the per-tenant cache", async () => {
    const calls = fakeImages();
    await asUser(async () => {
      await generateImage({ prompt: "Same prompt" });
      const again = await generateImage({ prompt: "Same prompt" });
      expect(again.cached).toBe(true);
    });
    expect(calls).toHaveLength(1);
  });

  it("answers /api/generate-image with the same SSE event as before", async () => {
    fakeImages();
    const res = await asUser(() => imageGenerationStream({ prompt: "A post", size: "1792x1024" }));
    expect(res.headers.get("X-Creative-Model")).toBe(IMAGE_FLARE);
    const text = await res.text();
    expect(text).toContain("event: image_generation.completed");
    expect(JSON.parse(text.split("data: ")[1])).toEqual({
      b64_json: "iVBORw0KGgo=",
      mime_type: "image/png",
    });
  });

  it("sends the Images API body OpenRouter documents", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [{ b64_json: "AAAA", media_type: "image/png" }],
        usage: { cost: 0.05 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const image = await asUser(() =>
      generateImage({
        prompt: "Mug mockup",
        size: "1024x1280",
        routing: { referenceAssets: ["https://a/logo.png"] },
      }),
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/images");
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: IMAGE_FLARE,
      prompt: "Mug mockup",
      aspect_ratio: "3:4",
      n: 1,
      input_references: [{ type: "image_url", image_url: { url: "https://a/logo.png" } }],
    });
    expect(image.costUsd).toBe(0.05);
  });
});
