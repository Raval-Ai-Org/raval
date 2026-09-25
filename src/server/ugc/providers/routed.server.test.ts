import { describe, expect, it, vi } from "vitest";
import {
  canonicalModelKey,
  isKnownUgcModelKey,
  isUgcModelKey,
  LEGACY_UGC_MODEL_KEYS,
  resolveUgcModel,
  specFor,
  UGC_MODELS,
} from "@/lib/ugc/models";
import { AiGatewayError } from "@/lib/ai-gateway.server";
import { signOpenRouterCallback, verifyOpenRouterCallback } from "../webhook.server";
import { buildOpenRouterVideoBody, openRouterFailure } from "./openrouter.server";
import { createRoutedVideoProvider } from "./routed.server";
import type { SubmitResult, VideoProvider, VideoRenderRequest } from "./types";

function fake(id: "kie" | "openrouter", results: SubmitResult[]) {
  const submits: VideoRenderRequest[] = [];
  const provider: VideoProvider = {
    id,
    generationType: () => "TEXT",
    submit: vi.fn(async (req: VideoRenderRequest) => {
      submits.push(req);
      return (
        results.shift() ?? {
          ok: true as const,
          taskId: `${id}-task`,
          request: {},
          provider: id,
          providerModel: req.model.providerModel,
        }
      );
    }),
    check: vi.fn(async () => ({ state: "pending" as const, providerState: id })),
  };
  return { provider, submits };
}

const request = (over: Partial<VideoRenderRequest> = {}): VideoRenderRequest => ({
  model: UGC_MODELS.standard,
  prompt: "A creator holds the serum",
  durationSec: 8,
  aspectRatio: "9:16",
  resolution: "720p",
  imageUrls: [],
  ...over,
});

describe("video provider fallback", () => {
  it("falls back from KIE to OpenRouter when KIE is out of credits", async () => {
    const kie = fake("kie", [
      {
        ok: false,
        code: "provider_credits",
        message: "no credits",
        retryable: false,
        definite: true,
      },
    ]);
    const or = fake("openrouter", []);
    const routed = createRoutedVideoProvider({
      providers: { kie: kie.provider, openrouter: or.provider },
      primary: () => "kie",
      fallback: () => "openrouter",
    });
    const result = await routed.submit(request());
    expect(result).toMatchObject({
      ok: true,
      provider: "openrouter",
      providerModel: "google/veo-3.1-fast",
    });
    // The same job, as OpenRouter runs it.
    expect(or.submits[0].model.providerModel).toBe("google/veo-3.1-fast");
    expect(or.submits[0].prompt).toBe("A creator holds the serum");
  });

  it("never submits elsewhere when KIE's outcome is unknown", async () => {
    const kie = fake("kie", [
      { ok: false, code: "provider_timeout", message: "timed out", retryable: true },
    ]);
    const or = fake("openrouter", []);
    const routed = createRoutedVideoProvider({
      providers: { kie: kie.provider, openrouter: or.provider },
      primary: () => "kie",
      fallback: () => "openrouter",
    });
    const result = await routed.submit(request());
    expect(result).toMatchObject({ ok: false, code: "provider_timeout", retryable: true });
    expect(or.submits).toHaveLength(0);
  });

  it("stays on KIE when the fallback is switched off, and goes OpenRouter-only with one switch", async () => {
    const kie = fake("kie", [
      {
        ok: false,
        code: "provider_credits",
        message: "no credits",
        retryable: false,
        definite: true,
      },
    ]);
    const or = fake("openrouter", []);
    const off = createRoutedVideoProvider({
      providers: { kie: kie.provider, openrouter: or.provider },
      primary: () => "kie",
      fallback: () => null,
    });
    expect(await off.submit(request())).toMatchObject({ ok: false, code: "provider_credits" });
    expect(or.submits).toHaveLength(0);

    const onlyOr = createRoutedVideoProvider({
      providers: { kie: kie.provider, openrouter: or.provider },
      primary: () => "openrouter",
      fallback: () => null,
    });
    expect(await onlyOr.submit(request())).toMatchObject({ ok: true, provider: "openrouter" });
    expect(kie.submits).toHaveLength(1);
  });

  it("adapts settings to the fallback's capabilities", async () => {
    const kie = fake("kie", [
      { ok: false, code: "provider_configuration", message: "x", retryable: false, definite: true },
    ]);
    const or = fake("openrouter", []);
    const routed = createRoutedVideoProvider({
      providers: { kie: kie.provider, openrouter: or.provider },
      primary: () => "kie",
      fallback: () => "openrouter",
    });
    // Cinematic on KIE (MiniMax H3 768p) → OpenRouter Hailuo 3 renders 2K only.
    await routed.submit(
      request({ model: UGC_MODELS.cinematic, resolution: "768p", durationSec: 4 }),
    );
    expect(or.submits[0]).toMatchObject({ resolution: "2k", durationSec: 5 });
  });

  it("checks a job with the provider that accepted it", async () => {
    const kie = fake("kie", []);
    const or = fake("openrouter", []);
    const routed = createRoutedVideoProvider({
      providers: { kie: kie.provider, openrouter: or.provider },
      primary: () => "kie",
    });
    expect(await routed.check("t1", "openrouter")).toMatchObject({ providerState: "openrouter" });
    expect(await routed.check("t2", "kie")).toMatchObject({ providerState: "kie" });
  });
});

describe("OpenRouter video requests", () => {
  it("sends first frames for image-to-video and references for reference-to-video", () => {
    const standard = specFor(UGC_MODELS.standard, "openrouter")!;
    expect(
      buildOpenRouterVideoBody(
        request({ model: standard, imageUrls: ["https://x/a.png", "https://x/b.png"] }),
      ),
    ).toEqual({
      model: "google/veo-3.1-fast",
      prompt: "A creator holds the serum",
      duration: 8,
      resolution: "720p",
      aspect_ratio: "9:16",
      generate_audio: true,
      frame_images: [
        { type: "image_url", image_url: { url: "https://x/a.png" }, frame_type: "first_frame" },
      ],
    });
    const premium = specFor(UGC_MODELS.premium, "openrouter")!;
    const body = buildOpenRouterVideoBody(
      request({ model: premium, resolution: "2k", imageUrls: ["https://x/a.png"] }),
      "https://app.example.com/api/public/hooks/openrouter-video",
    );
    expect(body).toMatchObject({
      model: "minimax/hailuo-3",
      resolution: "2K",
      input_references: [{ type: "image_url", image_url: { url: "https://x/a.png" } }],
      callback_url: "https://app.example.com/api/public/hooks/openrouter-video",
    });
    expect(body).not.toHaveProperty("frame_images");
    // Grok Imagine has no audio track to ask for.
    expect(
      buildOpenRouterVideoBody(request({ model: specFor(UGC_MODELS.variation, "openrouter")! })),
    ).not.toHaveProperty("generate_audio");
  });

  it("marks credit and auth errors definite, and transport errors unknown", () => {
    expect(openRouterFailure(new AiGatewayError(402, "x", "insufficient_credits"))).toMatchObject({
      code: "provider_credits",
      definite: true,
    });
    expect(openRouterFailure(new AiGatewayError(504, "x", "timeout"))).toMatchObject({
      retryable: true,
    });
    expect(openRouterFailure(new AiGatewayError(504, "x", "timeout")).definite).toBeUndefined();
  });

  it("verifies callback signatures and rejects stale or forged ones", () => {
    const secret = "whsec_test";
    const body = JSON.stringify({ type: "video.generation.completed", data: { id: "job_123" } });
    const t = "1790000000";
    const sig = `t=${t},v1=${signOpenRouterCallback(t, body, secret)}`;
    expect(
      verifyOpenRouterCallback({ rawBody: body, signature: sig, secret, nowSeconds: 1790000010 }),
    ).toEqual({ ok: true, taskId: "job_123" });
    expect(
      verifyOpenRouterCallback({ rawBody: body, signature: sig, secret, nowSeconds: 1790001000 }),
    ).toMatchObject({ ok: false, reason: "stale timestamp" });
    expect(
      verifyOpenRouterCallback({
        rawBody: `${body} `,
        signature: sig,
        secret,
        nowSeconds: 1790000010,
      }),
    ).toMatchObject({ ok: false, reason: "bad signature" });
    expect(
      verifyOpenRouterCallback({ rawBody: body, signature: sig, secret: undefined }),
    ).toMatchObject({
      ok: false,
      status: 503,
    });
  });
});

describe("model catalog", () => {
  it("keeps every old key readable as an alias, and offers only new keys for new jobs", () => {
    for (const key of LEGACY_UGC_MODEL_KEYS) {
      expect(isKnownUgcModelKey(key)).toBe(true);
      expect(isUgcModelKey(key)).toBe(false);
      const model = resolveUgcModel(key);
      expect(model.key).toBe(key);
      expect(model.legacy?.aliasOf).toBe(canonicalModelKey(key));
    }
    expect(resolveUgcModel("kling-3").providerModel).toBe("minimax-h3/reference-to-video");
    expect(resolveUgcModel("veo-3-1-fast", "openrouter").providerModel).toBe("google/veo-3.1-fast");
  });

  it("gives every current model both providers", () => {
    for (const model of Object.values(UGC_MODELS)) {
      expect(specFor(model, "kie"), model.key).not.toBeNull();
      expect(specFor(model, "openrouter"), model.key).not.toBeNull();
    }
    expect(specFor(UGC_MODELS.premium, "openrouter")!.providerModel).toBe("minimax/hailuo-3");
    expect(specFor(UGC_MODELS.long, "openrouter")!.providerModel).toBe(
      "bytedance/seedance-2.0-fast",
    );
  });
});

describe("fallback scope", () => {
  it("keeps a validation rejection or rate limit on KIE (no OpenRouter spend)", async () => {
    for (const code of ["provider_rejected", "provider_rate_limit"]) {
      const kie = fake("kie", [
        { ok: false, code, message: "no", retryable: code !== "provider_rejected", definite: true },
      ]);
      const or = fake("openrouter", []);
      const routed = createRoutedVideoProvider({
        providers: { kie: kie.provider, openrouter: or.provider },
        primary: () => "kie",
        fallback: () => "openrouter",
      });
      expect(await routed.submit(request())).toMatchObject({ ok: false, code });
      expect(or.submits).toHaveLength(0);
    }
  });

  it("falls back on auth failure and an unavailable model", async () => {
    for (const code of ["provider_configuration", "provider_model_unavailable"]) {
      const kie = fake("kie", [
        { ok: false, code, message: "no", retryable: false, definite: true },
      ]);
      const or = fake("openrouter", []);
      const routed = createRoutedVideoProvider({
        providers: { kie: kie.provider, openrouter: or.provider },
        primary: () => "kie",
        fallback: () => "openrouter",
      });
      expect(await routed.submit(request())).toMatchObject({ ok: true, provider: "openrouter" });
    }
  });
});

describe("frame image preparation", () => {
  it("passes JPEG/PNG links through and re-encodes other formats as PNG", async () => {
    const sharp = (await import("sharp")).default;
    const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#f00" } })
      .webp()
      .toBuffer();
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#0f0" } })
      .png()
      .toBuffer();
    vi.resetModules();
    vi.doMock("@/server/safe-fetch", () => ({
      safeFetch: async (url: string) => ({
        ok: true,
        status: 200,
        url,
        headers: new Headers({
          "content-type": url.endsWith(".webp") ? "image/webp" : "image/png",
        }),
        bytes: new Uint8Array(url.endsWith(".webp") ? webp : png),
        truncated: false,
        text: () => "",
      }),
    }));
    const { frameReadyImage } = await import("./openrouter.server");
    expect(await frameReadyImage("https://cdn.example.com/a.png")).toBe(
      "https://cdn.example.com/a.png",
    );
    const converted = await frameReadyImage("https://cdn.example.com/b.webp");
    expect(converted.startsWith("data:image/png;base64,")).toBe(true);
    const meta = await sharp(Buffer.from(converted.split(",")[1], "base64")).metadata();
    expect(meta.format).toBe("png");
    vi.doUnmock("@/server/safe-fetch");
  });
});
