// stream.server.ts — a chat reply that can use tools while it streams (ADR-0033).
//
// Each round is one streamed completion from the gateway. Words go straight to
// the browser. If the model asked for tools, they run (reads) or are stored as
// buttons (changes), and the next round starts fresh with what was found added
// as reference data. The model's own tool-call turn is never replayed, so
// there is no reasoning to carry between rounds and this works the same on
// every model tier. The last round is given no tools, so it always ends in an
// answer.
//
// Alongside the words the stream carries `data: {"mellox": …}` lines: what the
// reply is looking at, what it remembered, and the buttons it offers.
import "server-only";
import type { ChatMessage } from "@/lib/ai-gateway.server";
import type { ChatStreamEvent } from "@/lib/chat/events";
import { UNTRUSTED_DATA_RULE } from "@/server/guardrails/untrusted";
import {
  activityLabel,
  isQuietTool,
  type ChatToolSpec,
  type createChatTools,
} from "./tools.server";

/** Rounds that may use tools; one more round without tools writes the answer. */
const MAX_TOOL_ROUNDS = 3;
const MAX_TOOL_CALLS = 8;
const MAX_LOOKUP_CHARS = 16_000;
/** Input budget once lookups are part of the prompt (the gateway default is 16k). */
export const LOOKUP_INPUT_CHARS = 44_000;

type ToolCall = { name: string; args: string };

export type ChatRound = (
  messages: ChatMessage[],
  opts: { tools?: ChatToolSpec[]; inputChars?: number },
) => Promise<Response>;

const encoder = new TextEncoder();
const line = (payload: unknown) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
const event = (mellox: ChatStreamEvent) => line({ mellox });
const words = (content: string) => line({ choices: [{ delta: { content } }] });

/** What the lookups found, as one system message for the next round. */
function lookupMessage(lookups: string[], said: string): ChatMessage {
  let used = 0;
  const kept: string[] = [];
  for (const lookup of lookups) {
    if (used + lookup.length > MAX_LOOKUP_CHARS) break;
    used += lookup.length;
    kept.push(lookup);
  }
  return {
    role: "system",
    content: [
      "## What Mellox just looked up for this reply",
      UNTRUSTED_DATA_RULE,
      "Answer from these results. Do not look the same thing up again.",
      ...kept,
      said.trim()
        ? `You have already written this to the person, so continue from it without repeating it:\n${said.trim().slice(-1500)}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/**
 * Read one streamed completion: forward its words, collect its tool calls.
 * Reasoning never reaches here (the gateway strips it).
 */
async function readRound(
  response: Response,
  out: ReadableStreamDefaultController<Uint8Array>,
  onReader: (reader: ReadableStreamDefaultReader<Uint8Array> | null) => void,
): Promise<{ text: string; calls: ToolCall[] }> {
  const calls = new Map<number, ToolCall>();
  let text = "";
  if (!response.body) return { text, calls: [] };
  const reader = response.body.getReader();
  onReader(reader);
  const decoder = new TextDecoder();
  let pending = "";

  const handle = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("data:")) return;
    const json = trimmed.slice(5).trim();
    if (!json || json === "[DONE]") return;
    let payload: any;
    try {
      payload = JSON.parse(json);
    } catch {
      return;
    }
    if (payload?.mellox) {
      out.enqueue(line(payload));
      return;
    }
    const delta = payload?.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.content === "string" && delta.content) {
      text += delta.content;
      out.enqueue(words(delta.content));
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const part of delta.tool_calls) {
        const index = typeof part?.index === "number" ? part.index : calls.size;
        const call = calls.get(index) ?? { name: "", args: "" };
        if (typeof part?.function?.name === "string") call.name += part.function.name;
        if (typeof part?.function?.arguments === "string") call.args += part.function.arguments;
        calls.set(index, call);
      }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        handle(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
    }
    pending += decoder.decode();
    if (pending) handle(pending);
  } finally {
    onReader(null);
  }
  return { text, calls: [...calls.values()].filter((call) => call.name) };
}

function parseArgs(raw: string): unknown {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * The whole reply as one SSE stream. `first` is the already-opened first
 * round, so a failure to start (no balance, provider down) is still an
 * ordinary error response, as it was before tools.
 */
export function chatReplyStream(opts: {
  first: Response;
  messages: ChatMessage[];
  round: ChatRound;
  tools: ReturnType<typeof createChatTools>;
}): ReadableStream<Uint8Array> {
  let current: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const run = async () => {
        const lookups: string[] = [];
        let said = "";
        let toolCalls = 0;
        let response = opts.first;

        for (let round = 1; ; round++) {
          const { text, calls } = await readRound(response, controller, (r) => (current = r));
          said += text;
          if (cancelled || !calls.length || round > MAX_TOOL_ROUNDS) break;

          let needsAnswer = false;
          for (const call of calls) {
            if (toolCalls >= MAX_TOOL_CALLS) break;
            toolCalls++;
            const label = activityLabel(call.name);
            if (label) controller.enqueue(event({ tool: { label, state: "start" } }));
            const input = parseArgs(call.args);
            const outcome =
              input === null
                ? { content: "The tool arguments were not valid JSON.", label: null }
                : await opts.tools.run(call.name, input);
            if (label) controller.enqueue(event({ tool: { label, state: "done" } }));
            lookups.push(`### ${call.name}\n${outcome.content}`);
            if (!isQuietTool(call.name)) needsAnswer = true;
          }
          // It already answered in words and only saved a memory or offered a
          // button: there is nothing left to say, so no second model call.
          if (!needsAnswer && said.trim()) break;
          if (cancelled) break;

          if (said && !said.endsWith("\n")) {
            said += "\n\n";
            controller.enqueue(words("\n\n"));
          }
          const last = round >= MAX_TOOL_ROUNDS;
          response = await opts.round([...opts.messages, lookupMessage(lookups, said)], {
            tools: last ? undefined : opts.tools.specs,
            inputChars: LOOKUP_INPUT_CHARS,
          });
        }

        const { memory, actions, offers } = opts.tools.state;
        if (memory.length) controller.enqueue(event({ memory }));
        if (actions.length) controller.enqueue(event({ actions }));
        if (offers.length) controller.enqueue(event({ offers }));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      };
      run().catch((error) => {
        if (!cancelled) controller.error(error);
      });
    },
    async cancel(reason) {
      cancelled = true;
      await current?.cancel(reason).catch(() => undefined);
    },
  });
}
