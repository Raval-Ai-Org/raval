import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/ai/metering", () => ({ recordUsage: vi.fn() }));

import { localCutout, localSpeech } from "./client.server";

describe("local AI client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is off without LOCAL_AI_URL and never calls out", async () => {
    vi.stubEnv("LOCAL_AI_URL", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await localCutout(Buffer.from("x"))).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails open to null when the sidecar errors", async () => {
    vi.stubEnv("LOCAL_AI_URL", "http://127.0.0.1:8090");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await localCutout(Buffer.from("x"))).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no", { status: 500 })));
    expect(await localCutout(Buffer.from("x"))).toBeNull();
  });

  it("leaves unsupported languages to the paid voice", async () => {
    vi.stubEnv("LOCAL_AI_URL", "http://127.0.0.1:8090");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await localSpeech("Hallo", { language: "de" })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
