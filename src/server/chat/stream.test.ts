import { describe, expect, it, vi } from "vitest";

vi.mock("./tools.server", () => ({
  activityLabel: (name: string) =>
    name === "list_content"
      ? "Looking at your posts"
      : name === "remember"
        ? "Updating memory"
        : null,
  isQuietTool: (name: string) => name !== "list_content",
}));

import { chatReplyStream, LOOKUP_INPUT_CHARS, type ChatRound } from "./stream.server";

type Chunk = { content?: string; tool?: { index?: number; name?: string; args?: string } };

/** One streamed completion, as the gateway passes it through. */
function sse(chunks: Chunk[], extra: string[] = []): Response {
  const lines = chunks.map((c) => {
    const delta: Record<string, unknown> = {};
    if (c.content !== undefined) delta.content = c.content;
    if (c.tool) {
      delta.tool_calls = [
        { index: c.tool.index ?? 0, function: { name: c.tool.name, arguments: c.tool.args } },
      ];
    }
    return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
  });
  return new Response([...lines, ...extra, "data: [DONE]\n\n"].join(""));
}

function fakeTools(results: Record<string, string> = {}) {
  const state = { memory: [] as unknown[], actions: [] as unknown[], offers: [] as unknown[] };
  const run = vi.fn(async (name: string) => ({ content: results[name] ?? "ok", label: null }));
  return { state, run, specs: [{ type: "function", function: { name: "list_content" } }] } as never;
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const text = await new Response(stream).text();
  const payloads = text
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)));
  return {
    text,
    words: payloads.map((p) => p.choices?.[0]?.delta?.content ?? "").join(""),
    events: payloads.filter((p) => p.mellox).map((p) => p.mellox),
  };
}

const messages = [{ role: "user" as const, content: "What's pending?" }];

describe("chatReplyStream", () => {
  it("passes a plain reply straight through with no second call", async () => {
    const round = vi.fn();
    const out = await collect(
      chatReplyStream({
        first: sse([{ content: "Hello " }, { content: "there" }]),
        messages,
        round: round as unknown as ChatRound,
        tools: fakeTools(),
      }),
    );
    expect(out.words).toBe("Hello there");
    expect(round).not.toHaveBeenCalled();
    expect(out.text.trim().endsWith("data: [DONE]")).toBe(true);
  });

  it("runs a lookup, shows what it is doing, and answers from the result", async () => {
    const tools = fakeTools({ list_content: "2 posts pending" });
    const round = vi.fn(async () => sse([{ content: "Two posts are waiting." }]));
    const out = await collect(
      chatReplyStream({
        first: sse([
          { tool: { name: "list_content", args: '{"status":' } },
          { tool: { args: '"pending"}' } },
        ]),
        messages,
        round: round as unknown as ChatRound,
        tools,
      }),
    );
    expect((tools as { run: ReturnType<typeof vi.fn> }).run).toHaveBeenCalledWith("list_content", {
      status: "pending",
    });
    expect(out.events).toEqual([
      { tool: { label: "Looking at your posts", state: "start" } },
      { tool: { label: "Looking at your posts", state: "done" } },
    ]);
    expect(out.words).toBe("Two posts are waiting.");
    const [sent, opts] = round.mock.calls[0] as unknown as [
      { role: string; content: string }[],
      { tools?: unknown; inputChars?: number },
    ];
    expect(sent[0]).toEqual(messages[0]);
    expect(sent[1].role).toBe("system");
    expect(sent[1].content).toContain("### list_content\n2 posts pending");
    expect(opts.inputChars).toBe(LOOKUP_INPUT_CHARS);
    expect(opts.tools).toBeDefined();
  });

  it("makes no second call when the reply already answered and only saved a memory", async () => {
    const tools = fakeTools();
    (tools as { state: { memory: unknown[] } }).state.memory.push({
      op: "added",
      id: "m1",
      text: "Never use red",
    });
    const round = vi.fn();
    const out = await collect(
      chatReplyStream({
        first: sse([
          { content: "Got it, no red." },
          { tool: { name: "remember", args: '{"text":"Never use red"}' } },
        ]),
        messages,
        round: round as unknown as ChatRound,
        tools,
      }),
    );
    expect(round).not.toHaveBeenCalled();
    expect(out.words).toBe("Got it, no red.");
    expect(out.events).toEqual([
      { tool: { label: "Updating memory", state: "start" } },
      { tool: { label: "Updating memory", state: "done" } },
      { memory: [{ op: "added", id: "m1", text: "Never use red" }] },
    ]);
  });

  it("asks for words when a memory was saved before anything was said", async () => {
    const round = vi.fn(async () => sse([{ content: "Noted." }]));
    const out = await collect(
      chatReplyStream({
        first: sse([{ tool: { name: "remember", args: "{}" } }]),
        messages,
        round: round as unknown as ChatRound,
        tools: fakeTools(),
      }),
    );
    expect(round).toHaveBeenCalledTimes(1);
    expect(out.words).toBe("Noted.");
  });

  it("stops looking things up after three rounds and takes the tools away", async () => {
    const lookup = () => sse([{ tool: { name: "list_content", args: "{}" } }]);
    const round = vi
      .fn()
      .mockImplementationOnce(async () => lookup())
      .mockImplementationOnce(async () => lookup())
      .mockImplementationOnce(async () => sse([{ content: "Here is what I found." }]));
    const out = await collect(
      chatReplyStream({
        first: lookup(),
        messages,
        round: round as unknown as ChatRound,
        tools: fakeTools(),
      }),
    );
    expect(round).toHaveBeenCalledTimes(3);
    expect(
      (round.mock.calls[2] as unknown as [unknown, { tools?: unknown }])[1].tools,
    ).toBeUndefined();
    expect(out.words).toBe("Here is what I found.");
  });

  it("separates words written before and after a lookup, and forwards the cut-off marker", async () => {
    const round = vi.fn(async () =>
      sse([{ content: "Two are waiting." }], ['data: {"mellox":{"truncated":true}}\n\n']),
    );
    const out = await collect(
      chatReplyStream({
        first: sse([{ content: "Let me check." }, { tool: { name: "list_content", args: "{}" } }]),
        messages,
        round: round as unknown as ChatRound,
        tools: fakeTools(),
      }),
    );
    expect(out.words).toBe("Let me check.\n\nTwo are waiting.");
    expect(out.events).toContainEqual({ truncated: true });
  });

  it("tells the model when its arguments were not valid JSON instead of running the tool", async () => {
    const tools = fakeTools();
    const round = vi.fn(async () => sse([{ content: "Sorry." }]));
    await collect(
      chatReplyStream({
        first: sse([{ tool: { name: "list_content", args: "{oops" } }]),
        messages,
        round: round as unknown as ChatRound,
        tools,
      }),
    );
    expect((tools as { run: ReturnType<typeof vi.fn> }).run).not.toHaveBeenCalled();
    const sent = (round.mock.calls[0] as unknown as [{ content: string }[]])[0];
    expect(sent[1].content).toContain("not valid JSON");
  });
});
