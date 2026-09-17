import { afterEach, describe, expect, it, vi } from "vitest";
import { setHeliconeTransport } from "@/server/observability/helicone.server";
import { recordUsage, setUsageSink } from "./metering";

afterEach(() => {
  setUsageSink(async () => {});
  setHeliconeTransport(null);
  delete process.env.HELICONE_BASE_URL;
});

describe("recordUsage", () => {
  it("writes to the Postgres sink and, when configured, mirrors the same row to Helicone", async () => {
    process.env.HELICONE_BASE_URL = "http://localhost:8585";
    const sink = vi.fn().mockResolvedValue(undefined);
    const heliconeTransport = vi.fn().mockResolvedValue(undefined);
    setUsageSink(sink);
    setHeliconeTransport(heliconeTransport);

    recordUsage({ provider: "anthropic", model: "claude-sonnet-5", route: "test.route" });
    await Promise.resolve();
    await Promise.resolve();

    expect(sink).toHaveBeenCalledOnce();
    expect(heliconeTransport).toHaveBeenCalledOnce();
  });

  it("still writes to the Postgres sink when Helicone is not configured", async () => {
    const sink = vi.fn().mockResolvedValue(undefined);
    const heliconeTransport = vi.fn().mockResolvedValue(undefined);
    setUsageSink(sink);
    setHeliconeTransport(heliconeTransport);

    recordUsage({ provider: "openrouter", model: "qwen/qwen3-max", route: "test.route" });
    await Promise.resolve();

    expect(sink).toHaveBeenCalledOnce();
    expect(heliconeTransport).not.toHaveBeenCalled();
  });
});
