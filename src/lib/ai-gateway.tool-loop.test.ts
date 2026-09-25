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

import { AiGatewayError, setLlmTransport } from "./ai-gateway.server";
import {
  isLoopConversation,
  llmToolLoop,
  type LlmToolLoopOpts,
} from "./ai-gateway.tool-loop.server";
import { PREMIUM, WORKHORSE } from "@/server/ai/task-models";

type Reply = {
  finish_reason: string;
  message: Record<string, unknown>;
  model?: string;
  usage?: Record<string, unknown>;
};

function scripted(replies: (Reply | Error)[]) {
  const bodies: Record<string, any>[] = [];
  const restore = setLlmTransport(async (body) => {
    bodies.push(JSON.parse(JSON.stringify(body)));
    const next = replies.shift();
    if (!next) throw new Error("no more scripted replies");
    if (next instanceof Error) throw next;
    return {
      model: next.model ?? PREMIUM,
      choices: [
        { finish_reason: next.finish_reason, message: { role: "assistant", ...next.message } },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.01, ...next.usage },
    };
  });
  return { bodies, restore };
}

const call = (id: string, name: string, input: unknown) => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(input) },
});
const toolTurn = (...calls: ReturnType<typeof call>[]): Reply => ({
  finish_reason: "tool_calls",
  message: { content: null, tool_calls: calls },
});

const base = (over: Partial<LlmToolLoopOpts> = {}): LlmToolLoopOpts => ({
  route: "geo.agent.investigate",
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

describe("llmToolLoop", () => {
  it("runs tools, stops at the submission and meters every turn", async () => {
    const s = scripted([
      toolTurn(call("t1", "read_file", { path: "a" })),
      toolTurn(call("t2", "submit", { ok: true })),
    ]);
    restore = s.restore;
    const r = await llmToolLoop(base());
    expect(r.status).toBe("submitted");
    expect(r.submission).toEqual({ tool: "submit", input: { ok: true } });
    expect(s.bodies[0].tools[0]).toMatchObject({
      type: "function",
      function: { name: "read_file", strict: true },
    });
    expect(usage.rows).toHaveLength(2);
    expect(usage.rows[0]).toMatchObject({
      workspaceId: "ws-1",
      userId: "u-1",
      provider: "openrouter",
      model: PREMIUM,
      estCostUsd: 0.01,
    });
  });

  it("round-trips reasoning_details unchanged across three turns", async () => {
    const r1 = [{ type: "reasoning.text", text: "first", signature: "sig-1" }];
    const r2 = [{ type: "reasoning.encrypted", data: "opaque-2" }];
    const s = scripted([
      {
        ...toolTurn(call("a", "read_file", { p: 1 })),
        message: {
          content: null,
          tool_calls: [call("a", "read_file", { p: 1 })],
          reasoning_details: r1,
        },
      },
      {
        ...toolTurn(call("b", "read_file", { p: 2 })),
        message: {
          content: "",
          tool_calls: [call("b", "read_file", { p: 2 })],
          reasoning_details: r2,
        },
      },
      toolTurn(call("c", "submit", {})),
    ]);
    restore = s.restore;
    const r = await llmToolLoop(base());
    expect(r.status).toBe("submitted");
    const assistants = (b: any) => b.messages.filter((m: any) => m.role === "assistant");
    // Turn 2 replays turn 1's reasoning; turn 3 replays both, byte for byte.
    expect(assistants(s.bodies[1])[0].reasoning_details).toEqual(r1);
    expect(assistants(s.bodies[2])[0].reasoning_details).toEqual(r1);
    expect(assistants(s.bodies[2])[1].reasoning_details).toEqual(r2);
    // Earlier turns are never edited: turn 3's prefix is exactly turn 2's request.
    const withoutCache = (msgs: any[]) =>
      msgs
        .slice(0, -1)
        .map((m) => JSON.stringify(m))
        .join("\n");
    expect(withoutCache(s.bodies[2].messages)).toContain(withoutCache(s.bodies[1].messages));
    // Bookkeeping never goes back to the API; reasoning is requested, not excluded.
    expect(JSON.stringify(s.bodies[2].messages)).not.toContain('"model"');
    expect(s.bodies[0].reasoning).toEqual({ effort: "high" });
  });

  it("never forces tool use", async () => {
    const s = scripted([toolTurn(call("t", "submit", {}))]);
    restore = s.restore;
    await llmToolLoop(base());
    expect(s.bodies[0].tool_choice).toBe("auto");
    expect(s.bodies[0].provider).toEqual({ data_collection: "deny", require_parameters: true });
  });

  it("fails over on the first turn only, then stays on the model that answered", async () => {
    const s = scripted([
      { ...toolTurn(call("t1", "read_file", {})), model: WORKHORSE },
      toolTurn(call("t2", "submit", {})),
    ]);
    restore = s.restore;
    const r = await llmToolLoop(base());
    expect(s.bodies[0].models).toEqual([PREMIUM, WORKHORSE]);
    expect(s.bodies[1].models).toEqual([WORKHORSE]);
    expect(r.model).toBe(PREMIUM);
    expect(usage.rows[0]).toMatchObject({ model: WORKHORSE });
  });

  it("returns each parallel tool result as its own tool message, errors flagged", async () => {
    const s = scripted([
      toolTurn(call("a", "read_file", { p: 1 }), call("b", "read_file", { p: 2 })),
      toolTurn(call("c", "submit", {})),
    ]);
    restore = s.restore;
    const r = await llmToolLoop(
      base({
        handleTool: async (name, input) => {
          if ((input as { p?: number }).p === 2) throw new Error("boom");
          return { content: "fine", summary: name };
        },
      }),
    );
    const tools = s.bodies[1].messages.filter((m: any) => m.role === "tool");
    expect(tools.map((m: any) => m.tool_call_id)).toEqual(["a", "b"]);
    expect(JSON.stringify(tools[1].content)).toContain("Error: boom");
    expect(r.status).toBe("submitted");
  });

  it("marks the system prompt and the rolling last message for Anthropic caching", async () => {
    const s = scripted([toolTurn(call("t1", "read_file", {})), toolTurn(call("t2", "submit", {}))]);
    restore = s.restore;
    await llmToolLoop(base());
    const count = (b: any) => JSON.stringify(b).split('"cache_control"').length - 1;
    expect(count(s.bodies[0])).toBe(2);
    expect(count(s.bodies[1])).toBe(2);
    const last = s.bodies[1].messages.at(-1);
    expect(last.role).toBe("tool");
    expect(last.content[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("does not submit when the terminal tool's handler rejects the input", async () => {
    const s = scripted([
      toolTurn(call("t1", "submit", { bad: true })),
      toolTurn(call("t2", "submit", { bad: false })),
    ]);
    restore = s.restore;
    const r = await llmToolLoop(
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
      { finish_reason: "stop", message: { content: "done?" } },
      { finish_reason: "stop", message: { content: "still no" } },
    ]);
    restore = s.restore;
    const r = await llmToolLoop(base());
    expect(r.status).toBe("no_submission");
    expect(JSON.stringify(s.bodies[1].messages.at(-1))).toContain("submit");
  });

  it("stops at the turn cap, the cost cap, the deadline and on cancel", async () => {
    let s = scripted(Array.from({ length: 3 }, (_, i) => toolTurn(call(`t${i}`, "read_file", {}))));
    restore = s.restore;
    expect((await llmToolLoop(base({ maxTurns: 3 }))).status).toBe("max_turns");
    restore();

    s = scripted([{ ...toolTurn(call("t", "read_file", {})), usage: { cost: 1 } }]);
    restore = s.restore;
    expect((await llmToolLoop(base({ maxCostUsd: 0.5 }))).status).toBe("budget");
    restore();

    s = scripted([]);
    restore = s.restore;
    expect((await llmToolLoop(base({ deadlineAt: Date.now() - 1 }))).status).toBe("deadline");
    expect((await llmToolLoop(base({ isCancelled: () => true }))).status).toBe("cancelled");
    expect(s.bodies).toHaveLength(0);
  });

  it("sends nothing when the budget blocks, and stops when it degrades", async () => {
    const s = scripted([]);
    restore = s.restore;
    budget.mode = "block";
    await expect(llmToolLoop(base())).rejects.toThrow(/limit/);
    budget.mode = "degrade";
    expect((await llmToolLoop(base())).status).toBe("budget");
    expect(s.bodies).toHaveLength(0);
  });

  it("throws on refusal and cut-off turns, and passes context overflow through", async () => {
    for (const [reply, code] of [
      [{ finish_reason: "content_filter", message: { content: null } }, "refusal"],
      [{ finish_reason: "length", message: { content: "" } }, "max_tokens"],
      [new AiGatewayError(413, "too big", "context_exceeded"), "context_exceeded"],
    ] as const) {
      const s = scripted([reply as Reply | Error]);
      restore = s.restore;
      await expect(llmToolLoop(base())).rejects.toMatchObject({ code });
      restore();
      restore = null;
    }
  });

  it("truncates oversized tool results", async () => {
    const s = scripted([toolTurn(call("t", "read_file", {})), toolTurn(call("u", "submit", {}))]);
    restore = s.restore;
    await llmToolLoop(
      base({
        maxToolResultChars: 100,
        handleTool: async () => ({ content: "x".repeat(500), summary: "big" }),
      }),
    );
    const tool = s.bodies[1].messages.find((m: any) => m.role === "tool");
    const text: string = typeof tool.content === "string" ? tool.content : tool.content[0].text;
    expect(text.length).toBeLessThan(200);
    expect(text).toContain("truncated 400");
  });

  it("recognises old Anthropic-format checkpoints as not resumable", () => {
    expect(isLoopConversation([{ role: "user", content: "hi" }])).toBe(true);
    expect(
      isLoopConversation([
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "tool_use", id: "t", name: "x", input: {} }] },
      ]),
    ).toBe(false);
    expect(
      isLoopConversation([{ role: "user", content: [{ type: "tool_result", tool_use_id: "t" }] }]),
    ).toBe(false);
  });
});
