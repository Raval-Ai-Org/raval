import { afterEach, describe, expect, it, vi } from "vitest";

const readBrandDna = vi.hoisted(() => vi.fn());
const getLatestMarketBrain = vi.hoisted(() => vi.fn());
vi.mock("@/server/workspaces/brand-dna.server", () => ({ readBrandDna }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/market-brain-latest.server", () => ({ getLatestMarketBrain }));

import { campaignGenerationWorkflow } from "./campaign-generation.workflow";

afterEach(() => {
  readBrandDna.mockReset();
  getLatestMarketBrain.mockReset();
  delete process.env.OPENROUTER_API_KEY;
  vi.unstubAllGlobals();
});

describe("campaignGenerationWorkflow", () => {
  it("gathers brand context, then grounds the generated brief in it", async () => {
    readBrandDna.mockResolvedValue({
      dna: {
        brandName: "Mellox",
        oneLiner: "AI marketing intelligence",
        about: "Helps small teams market like agencies",
        audience: "Solo founders",
        voice: "Confident, direct",
        values: "Speed, clarity",
        products: "Brand DNA, GEO audits, Studio",
        customer: { painPoints: "No time to plan useful weekly content" },
        competitors: [{ name: "AgencyCo", positioning: "Enterprise campaigns" }],
      },
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    getLatestMarketBrain.mockResolvedValue({
      result: { completedAt: new Date().toISOString() },
      intelligence: { opportunities: [{ title: "Founder search questions" }], relatedQueries: [] },
    });
    const brief = {
      theme: "Launch week",
      keyMessage: "Market like an agency, without one",
      targetAudience: "Solo founders",
      callToAction: "Start free",
      contentIdeas: [{ channel: "email", idea: "Founder story", hook: "We built this because..." }],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "anthropic/claude-opus-5.5",
          choices: [
            {
              finish_reason: "stop",
              message: { role: "assistant", content: JSON.stringify(brief) },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const run = await campaignGenerationWorkflow.createRun();
    const result = await run.start({
      inputData: { workspaceId: "ws-1", goal: "Launch week signups", channels: ["email"] },
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.result).toEqual(brief);

    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.messages[1].content).toContain("<untrusted_data");
    expect(request.messages[1].content).toContain("Mellox");
    expect(request.messages[1].content).toContain("Launch week signups");
    expect(request.messages[1].content).toContain("No time to plan useful weekly content");
    expect(request.messages[1].content).toContain("AgencyCo");
    expect(request.messages[1].content).toContain("Founder search questions");
  });

  it("does not present an empty model result as a successful campaign", async () => {
    readBrandDna.mockResolvedValue(null);
    getLatestMarketBrain.mockResolvedValue(null);
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "anthropic/claude-opus-5.5",
          choices: [
            {
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify({
                  theme: "",
                  keyMessage: "",
                  targetAudience: "",
                  callToAction: "",
                  contentIdeas: [],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const run = await campaignGenerationWorkflow.createRun();
    const result = await run.start({
      inputData: { workspaceId: "ws-1", goal: "Awareness", channels: ["social"] },
    });

    expect(result.status).toBe("failed");
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.messages[1].content).toContain("(unknown)");
  });
});
