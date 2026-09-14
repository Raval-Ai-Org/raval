import { afterEach, describe, expect, it, vi } from "vitest";

process.env.KIE_API_KEY = "test-kie-key";

describe("KIE image gateway", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("classifies a missing server key as configuration, before making a request", async () => {
    const originalKey = process.env.KIE_API_KEY;
    delete process.env.KIE_API_KEY;
    try {
      const { imageGenerationStream } = await import("./kie-gateway.server");
      await expect(imageGenerationStream({ prompt: "A launch visual" })).rejects.toMatchObject({
        status: 503,
        category: "configuration",
      });
      expect(process.env.KIE_API_KEY).toBeUndefined();
    } finally {
      if (originalKey === undefined) delete process.env.KIE_API_KEY;
      else process.env.KIE_API_KEY = originalKey;
    }
  });

  it("creates, polls, downloads, and coalesces an image task", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith("/jobs/createTask"))
          return Response.json({ code: 200, data: { taskId: "task-1" } });
        if (url.includes("/jobs/recordInfo"))
          return Response.json({
            code: 200,
            data: {
              state: "success",
              resultJson: JSON.stringify({ resultUrls: ["https://cdn.kie.ai/image.png"] }),
            },
          });
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "content-type": "image/png" },
        });
      }),
    );

    const { imageGenerationStream } = await import("./kie-gateway.server");
    const [first, second] = await Promise.all([
      imageGenerationStream({ prompt: "A launch visual", size: "1792x1024" }),
      imageGenerationStream({ prompt: "A launch visual", size: "1792x1024" }),
    ]);

    expect(calls).toHaveLength(3);
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer test-kie-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      model: "gpt-image-2-5-flare-text-to-image",
      input: {
        prompt: "A launch visual",
        aspect_ratio: "16:9",
        resolution: "1K",
        background: "opaque",
      },
    });
    expect(await first.text()).toContain("image_generation.completed");
    expect(first.headers.get("X-Creative-Model")).toBe("gpt-image-2-5-flare-text-to-image");
    expect(first.headers.get("X-Creative-Route")).toBe("flare");
    expect(await second.text()).toContain("iVB");
  });

  it("accepts snake_case task IDs and nested result URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/jobs/createTask"))
          return Response.json({ code: 200, data: { task_id: "task-snake" } });
        if (url.includes("/jobs/recordInfo"))
          return Response.json({
            code: 200,
            data: {
              status: "completed",
              result_json: JSON.stringify({ images: [{ url: "https://cdn.kie.ai/nested.png" }] }),
            },
          });
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "content-type": "image/png" },
        });
      }),
    );

    const { imageGenerationStream } = await import("./kie-gateway.server");
    const response = await imageGenerationStream({
      prompt: "A nested result visual",
      size: "1024x1024",
    });
    expect(await response.text()).toContain("image_generation.completed");
  });

  it("routes references to Sunburst image-to-image and sends image_urls", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith("/jobs/createTask"))
          return Response.json({ code: 200, data: { taskId: "task-edit" } });
        if (url.includes("/jobs/recordInfo"))
          return Response.json({
            code: 200,
            data: {
              state: "success",
              resultJson: JSON.stringify({ resultUrls: ["https://cdn.kie.ai/edit.png"] }),
            },
          });
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "content-type": "image/png" },
        });
      }),
    );

    const { imageGenerationStream } = await import("./kie-gateway.server");
    const response = await imageGenerationStream({
      prompt: "Preserve the product subject",
      size: "1024x1024",
      routing: {
        taskType: "editing",
        hasReference: true,
        referenceAssets: ["https://cdn.example.com/reference.png"],
        requiredQuality: "maximum",
      },
    });
    const payload = JSON.parse(String(calls[0].init?.body));
    expect(payload.model).toBe("gpt-image-2-5-sunburst-image-to-image");
    expect(payload.input.image_urls).toEqual(["https://cdn.example.com/reference.png"]);
    expect(response.headers.get("X-Creative-Route")).toBe("sunburst-edit");
  });

  it("rejects an image-to-image request without a reference", async () => {
    const { imageGenerationStream } = await import("./kie-gateway.server");
    await expect(
      imageGenerationStream({
        prompt: "Edit the subject",
        routing: { taskType: "editing", hasReference: true },
      }),
    ).rejects.toMatchObject({ status: 422, category: "request" });
  });

  it("uses the live Kie Veo 3.1 contract and blocks unsupported durations", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith("/jobs/createTask"))
          return Response.json({ code: 200, data: { taskId: "task-video" } });
        return Response.json({
          code: 200,
          data: {
            state: "success",
            resultJson: JSON.stringify({ resultUrls: ["https://cdn.kie.ai/video.mp4"] }),
          },
        });
      }),
    );

    const { videoGeneration } = await import("./kie-gateway.server");
    const generated = await videoGeneration({
      prompt: "Short branded launch video",
      aspectRatio: "16:9",
      duration: 6,
      resolution: "720P",
      audio: false,
    });

    expect(generated.model).toBe("veo-3-1");
    expect(generated.videoUrl).toBe("https://cdn.kie.ai/video.mp4");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      model: "veo-3-1",
      input: {
        prompt: "Short branded launch video",
        aspect_ratio: "16:9",
        duration: 6,
        resolution: "720P",
      },
    });

    await expect(
      videoGeneration({
        prompt: "Invalid duration",
        duration: 5,
      }),
    ).rejects.toMatchObject({
      status: 400,
      category: "request",
    });
  });

  it("retries a transient 5xx from Kie once before succeeding", async () => {
    let createAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/jobs/createTask")) {
          createAttempts += 1;
          if (createAttempts === 1) return new Response("Service Unavailable", { status: 503 });
          return Response.json({ code: 200, data: { taskId: "task-retried" } });
        }
        if (url.includes("/jobs/recordInfo"))
          return Response.json({
            code: 200,
            data: {
              state: "success",
              resultJson: JSON.stringify({ resultUrls: ["https://cdn.kie.ai/retried.png"] }),
            },
          });
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "content-type": "image/png" },
        });
      }),
    );

    const { imageGenerationStream } = await import("./kie-gateway.server");
    const response = await imageGenerationStream({ prompt: "A resilient visual" });
    expect(createAttempts).toBe(2);
    expect(await response.text()).toContain("image_generation.completed");
  }, 10_000);

  it("falls back to the next candidate model when one model's task creation keeps failing", async () => {
    const modelsRequested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/jobs/createTask")) {
          const model = JSON.parse(String(init?.body)).model as string;
          modelsRequested.push(model);
          if (model === "gpt-image-2-5-flare-text-to-image")
            return new Response("Service Unavailable", { status: 503 });
          return Response.json({ code: 200, data: { taskId: "task-fallback" } });
        }
        throw new Error(`unexpected call to ${url}`);
      }),
    );

    const { startImageTask } = await import("./kie-gateway.server");
    const started = await startImageTask({ prompt: "A fallback visual", size: "1024x1024" });
    // The first candidate is retried (twice) before the gateway moves on.
    expect(modelsRequested.filter((m) => m === "gpt-image-2-5-flare-text-to-image")).toHaveLength(
      3,
    );
    expect(started.model).toBe("gpt-image-2-5-sunburst-text-to-image");
  }, 10_000);

  it("maps a provider failure to a clean generation error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/jobs/createTask"))
          return Response.json({ code: 200, data: { taskId: "task-failed" } });
        return Response.json({ code: 200, data: { state: "failed" } });
      }),
    );

    const { imageGenerationStream } = await import("./kie-gateway.server");
    await expect(imageGenerationStream({ prompt: "A failed visual" })).rejects.toMatchObject({
      status: 502,
      category: "generation",
    });
  });
});
