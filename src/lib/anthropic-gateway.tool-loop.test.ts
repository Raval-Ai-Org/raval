import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const budget = vi.hoisted(() => ({ mode: "ok" as "ok" | "degrade" | "block" }));
const usage = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock("@/server/ai/budget", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/budget")>();
  return { ...actual, checkBudget: vi.fn(async () => ({ mode: budget.mode, reason: "limit" })) };
});
vi.mock("@/server/ai/metering", () => ({
  recordUsage: (row: Record<string, unknown>) => usage.rows.push(row),
}));

import {
  claudeToolLoop,
  setClaudeTransport,
  type ClaudeToolLoopOpts,
} from "./anthropic-gateway.server";

type Reply = {
  stop_reason: string;
  content: Record<string, unknown>[];
  usage?: Record<string, number>;
};

function scripted(replies: Reply[]) {
  const payloads: Record<string, any>[] = [];
  const restore = setClaudeTransport(async (payload) => {
    payloads.push(JSON.parse(JSON.stringify(payload)));
    const next = replies.shift();
    if (!next) throw new Error("no more scripted replies");
    return { usage: { input_tokens: 100, output_tokens: 50, ...next.usage }, ...next };
  });
  return { payloads, restore };
}

const toolUse = (id: string, name: string, input: unknown) => ({
  type: "tool_use",
  id,
  name,
  input,
});

const base = (over: Partial<ClaudeToolLoopOpts> = {}): ClaudeToolLoopOpts => ({
  route: "test.loop",
  system: "You are a test agent.",
  tools: [
    { name: "read_file", description: "read", input_schema: { type: "object" }, strict: true },
    { name: "submit", description: "submit", input_schema: { type: "object" }, strict: true },
  ],
  messages: [{ role: "user", content: "Investigate." }],
  handleTool: async (name) => ({ content: `${name} ok`, summary: `ran ${name}` }),
  terminalTools: ["submit"],
  maxTurns: 6,
  maxCostUsd: 5,
  deadlineAt: Date.now() + 60_000,
  workspaceId: "ws-1",
  userId: "u-1",
  ...over,
});

let restore: (() => void) | null = null;
beforeEach(() => {
  budget.mode = "ok";
  usage.rows = [];
});
afterEach(() => {
  restore?.();
  restore = null;
});

describe("claudeToolLoop", () => {
  it("runs tools, echoes thinking blocks unchanged and stops at the submission", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig-abc" };
    const s = scripted([
      { stop_reason: "tool_use", content: [thinking, toolUse("t1", "read_file", { path: "a" })] },
      { stop_reason: "tool_use", content: [toolUse("t2", "submit", { ok: true })] },
    ]);
    restore = s.restore;
    const r = await claudeToolLoop(base());
    expect(r.status).toBe("submitted");
    expect(r.submission).toEqual({ tool: "submit", input: { ok: true } });
    // The second request replays the first assistant turn byte-for-byte.
    expect(s.payloads[1].messages[1].content[0]).toEqual(thinking);
    expect(s.payloads[0].tools[0].strict).toBe(true);
    expect(usage.rows).toHaveLength(2);
    expect(usage.rows[0]).toMatchObject({
      workspaceId: "ws-1",
      userId: "u-1",
      provider: "anthropic",
    });
  });

  it("returns every parallel tool result in one user message, errors flagged", async () => {
    const s = scripted([
      {
        stop_reason: "tool_use",
        content: [toolUse("a", "read_file", { p: 1 }), toolUse("b", "read_file", { p: 2 })],
      },
      { stop_reason: "tool_use", content: [toolUse("c", "submit", {})] },
    ]);
    restore = s.restore;
    const r = await claudeToolLoop(
      base({
        handleTool: async (name, input) => {
          if ((input as { p?: number }).p === 2) throw new Error("boom");
          return { content: "fine", summary: name };
        },
      }),
    );
    const results = s.payloads[1].messages[2].content;
    expect(results).toHaveLength(2);
    expect(results.map((x: any) => x.tool_use_id)).toEqual(["a", "b"]);
    expect(results[1]).toMatchObject({ is_error: true, content: "boom" });
    expect(r.status).toBe("submitted");
  });

  it("places at most two cache breakpoints and moves the rolling one", async () => {
    const s = scripted([
      { stop_reason: "tool_use", content: [toolUse("t1", "read_file", {})] },
      { stop_reason: "tool_use", content: [toolUse("t2", "submit", {})] },
    ]);
    restore = s.restore;
    await claudeToolLoop(base());
    const count = (p: any) => JSON.stringify(p).split('"cache_control"').length - 1;
    expect(count(s.payloads[0])).toBe(2);
    expect(count(s.payloads[1])).toBe(2);
    const last = s.payloads[1].messages.at(-1).content.at(-1);
    expect(last.type).toBe("tool_result");
    expect(last.cache_control).toEqual({ type: "ephemeral" });
  });

  it("does not submit when the terminal tool's handler rejects the input", async () => {
    const s = scripted([
      { stop_reason: "tool_use", content: [toolUse("t1", "submit", { bad: true })] },
      { stop_reason: "tool_use", content: [toolUse("t2", "submit", { bad: false })] },
    ]);
    restore = s.restore;
    const r = await claudeToolLoop(
      base({
        handleTool: async (_n, input) =>
          (input as { bad: boolean }).bad
            ? { content: "invalid plan", isError: true, summary: "rejected" }
            : { content: "accepted", summary: "accepted" },
      }),
    );
    expect(r.status).toBe("submitted");
    expect(r.submission?.input).toEqual({ bad: false });
  });

  it("nudges once when the model ends without submitting, then gives up", async () => {
    const s = scripted([
      { stop_reason: "end_turn", content: [{ type: "text", text: "done?" }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "still no" }] },
    ]);
    restore = s.restore;
    const r = await claudeToolLoop(base());
    expect(r.status).toBe("no_submission");
    expect(JSON.stringify(s.payloads[1].messages.at(-1))).toContain("submit");
  });

  it("continues after pause_turn without adding a user message", async () => {
    const s = scripted([
      { stop_reason: "pause_turn", content: [{ type: "text", text: "…" }] },
      { stop_reason: "tool_use", content: [toolUse("t", "submit", {})] },
    ]);
    restore = s.restore;
    const r = await claudeToolLoop(base());
    expect(r.status).toBe("submitted");
    expect(s.payloads[1].messages.at(-1).role).toBe("assistant");
  });

  it("stops at the turn cap, the cost cap, the deadline and on cancel", async () => {
    let s = scripted(
      Array.from({ length: 3 }, (_, i) => ({
        stop_reason: "tool_use",
        content: [toolUse(`t${i}`, "read_file", {})],
      })),
    );
    restore = s.restore;
    expect((await claudeToolLoop(base({ maxTurns: 3 }))).status).toBe("max_turns");
    restore();

    s = scripted([
      {
        stop_reason: "tool_use",
        content: [toolUse("t", "read_file", {})],
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      },
    ]);
    restore = s.restore;
    expect((await claudeToolLoop(base({ maxCostUsd: 0.5 }))).status).toBe("budget");
    restore();

    s = scripted([]);
    restore = s.restore;
    expect((await claudeToolLoop(base({ deadlineAt: Date.now() - 1 }))).status).toBe("deadline");
    expect((await claudeToolLoop(base({ isCancelled: () => true }))).status).toBe("cancelled");
    expect(s.payloads).toHaveLength(0);
  });

  it("sends nothing when the budget blocks, and stops when it degrades", async () => {
    const s = scripted([]);
    restore = s.restore;
    budget.mode = "block";
    await expect(claudeToolLoop(base())).rejects.toThrow(/limit/);
    budget.mode = "degrade";
    expect((await claudeToolLoop(base())).status).toBe("budget");
    expect(s.payloads).toHaveLength(0);
  });

  it("throws on refusal, cut-off turns and context overflow", async () => {
    for (const [stop, code] of [
      ["refusal", "refusal"],
      ["max_tokens", "max_tokens"],
      ["model_context_window_exceeded", "context_exceeded"],
    ] as const) {
      const s = scripted([{ stop_reason: stop, content: [] }]);
      restore = s.restore;
      await expect(claudeToolLoop(base())).rejects.toMatchObject({ code });
      restore();
      restore = null;
    }
  });

  it("truncates oversized tool results", async () => {
    const s = scripted([
      { stop_reason: "tool_use", content: [toolUse("t", "read_file", {})] },
      { stop_reason: "tool_use", content: [toolUse("u", "submit", {})] },
    ]);
    restore = s.restore;
    await claudeToolLoop(
      base({
        maxToolResultChars: 100,
        handleTool: async () => ({ content: "x".repeat(500), summary: "big" }),
      }),
    );
    const content: string = s.payloads[1].messages[2].content[0].content;
    expect(content.length).toBeLessThan(200);
    expect(content).toContain("truncated 400");
  });
});
