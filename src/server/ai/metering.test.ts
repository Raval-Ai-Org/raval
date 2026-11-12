import { afterEach, describe, expect, it, vi } from "vitest";
import { setHeliconeTransport } from "@/server/observability/helicone.server";
import { runWithScope, setRequestScope, withWorkflow } from "@/server/request-context";
import { usageTokens } from "@/lib/ai-gateway.server";
import { recordUsage, setUsageSink, toUsageRow } from "./metering";

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

    recordUsage({
      provider: "openrouter",
      model: "anthropic/claude-opus-5.5",
      route: "test.route",
    });
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

    recordUsage({ provider: "openrouter", model: "google/gemini-3.8-flash", route: "test.route" });
    await Promise.resolve();

    expect(sink).toHaveBeenCalledOnce();
    expect(heliconeTransport).not.toHaveBeenCalled();
  });
});

describe("workflow attribution and prompt-cache tokens", () => {
  const JOB = "11111111-1111-4111-8111-111111111111";
  const WS = "22222222-2222-4222-8222-222222222222";

  it("puts the workflow, its stage and the cache/reasoning tokens on the row", () => {
    const row = withWorkflow(
      { kind: "studio_job", id: JOB, stage: "writing", workspaceId: WS },
      () =>
        toUsageRow({
          provider: "openrouter",
          model: "google/gemini-3.8-flash",
          ...usageTokens({
            prompt_tokens: 5000,
            completion_tokens: 900,
            prompt_tokens_details: { cached_tokens: 4096, cache_write_tokens: 0 },
            completion_tokens_details: { reasoning_tokens: 300 },
          }),
        }),
    );
    expect(row).toMatchObject({
      workspace_id: WS,
      workflow_kind: "studio_job",
      workflow_id: JOB,
      workflow_stage: "writing",
      input_tokens: 5000,
      output_tokens: 900,
      cached_input_tokens: 4096,
      cache_write_tokens: 0,
      reasoning_tokens: 300,
    });
  });

  it("keeps the caller's request id and user, and a stage change stays inside the workflow", () => {
    runWithScope({ userId: "u1", requestId: "req-12345678" }, () => {
      withWorkflow({ kind: "ugc_render", id: JOB }, () => {
        setRequestScope({ workflowStage: "processing" });
        const inner = toUsageRow({ provider: "kie", model: "wan" });
        expect(inner).toMatchObject({
          user_id: "u1",
          request_id: "req-12345678",
          workflow_kind: "ugc_render",
          workflow_stage: "processing",
        });
      });
      const outer = toUsageRow({ provider: "kie", model: "wan" });
      expect(outer).toMatchObject({ workflow_kind: null, workflow_id: null, workflow_stage: null });
    });
  });

  it("records zeros, not gaps, when a provider reports no cache details", () => {
    const row = toUsageRow({ provider: "openrouter", model: "m", ...usageTokens(undefined) });
    expect(row).toMatchObject({
      cached_input_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
    });
  });
});
