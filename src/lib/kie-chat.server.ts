// kie-chat.server.ts — the text/vision/tool transport on KIE (kie.ai).
//
// The gateway (ai-gateway.server.ts) keeps building one OpenRouter-shaped
// chat-completions body: `models` (primary then fallbacks), `messages`,
// `tools`, `response_format`, `reasoning.effort`, `max_tokens`. This file sends
// that body to KIE, which serves each model family on its own API:
//
//   Claude  → POST /claude/v1/messages              (Anthropic Messages)
//   Gemini  → POST /<model>-openai/v1/chat/completions (OpenAI chat)
//   GPT     → POST /codex/v1/responses              (OpenAI Responses)
//   DeepSeek→ POST /openai/v1/responses             (OpenAI Responses)
//
// and turns every answer back into the OpenAI chat-completion shape the
// gateway, the tool loop and metering already read. Models are tried in the
// plan's order, then a safety net of models KIE serves reliably; a model KIE
// doesn't carry is mapped to its nearest stand-in (KIE_STAND_INS).
//
// Cost: KIE reports `credits_consumed`; it becomes `usage.cost` in USD
// (KIE_USD_PER_CREDIT), so metering records what KIE really charged.
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { fetchWithTimeout } from "@/server/upstream";
import { log } from "@/server/observability/logger";
import { AiGatewayError, type TransportOpts } from "./ai-gateway.server";

const KIE_API = "https://api.kie.ai";
/** KIE's temporary file store (files expire after a few days). */
const KIE_UPLOAD = "https://kieai.redpandaai.co/api/file-base64-upload";

type KieApi = "claude" | "gemini" | "codex" | "openai-responses";
export type KieTarget = { api: KieApi; model: string; id: string };

/**
 * The tier models (task-models.ts) on KIE. `id` is the OpenRouter id that is
 * reported back as the answering model, so pricing and logs stay readable.
 */
const KIE_MODELS: Record<string, Omit<KieTarget, "id">> = {
  "anthropic/claude-opus-5.5": { api: "claude", model: "claude-opus-5-5" },
  "anthropic/claude-sonnet-5.5": { api: "claude", model: "claude-sonnet-5-5" },
  "anthropic/claude-haiku-5.5": { api: "claude", model: "claude-haiku-5-5" },
  "google/gemini-4-carbon": { api: "gemini", model: "gemini-4-carbon" },
  "google/gemini-3.8-flash": { api: "gemini", model: "gemini-3-8-flash" },
  "openai/gpt-6.1-sol": { api: "codex", model: "gpt-6-1-sol" },
  "openai/gpt-6.1-terra": { api: "codex", model: "gpt-6-1-terra" },
  "openai/gpt-6.2-sol": { api: "codex", model: "gpt-6-2-sol" },
  "deepseek/deepseek-v4.1-flash": { api: "openai-responses", model: "deepseek-v4-1-flash" },
};

/**
 * Models KIE does not carry (checked live 2026-11-25), and what answers
 * instead. GPT-6 Luna was withdrawn by KIE; GLM and the DeepSeek 1017
 * snapshot were never listed.
 */
export const KIE_STAND_INS: Record<string, string> = {
  "openai/gpt-6-luna": "google/gemini-3.8-flash",
  "z-ai/glm-5.3-flash": "deepseek/deepseek-v4.1-flash",
  "deepseek/deepseek-v4.1-flash-1017": "deepseek/deepseek-v4.1-flash",
};

/**
 * Tried after the plan's own list: the models that answered every probe on
 * 2026-11-25 (KIE's Claude and Gemini 4 Carbon returned intermittent 500s).
 */
const SAFETY_NET = ["google/gemini-3.8-flash", "openai/gpt-6.1-sol"];

export function kieTargetFor(openRouterId: string): KieTarget {
  const id = KIE_STAND_INS[openRouterId] ?? openRouterId;
  const known = KIE_MODELS[id];
  if (known) return { ...known, id };
  const [vendor, rawName = ""] = id.split("/");
  const name = rawName.replace(/\./g, "-");
  if (vendor === "anthropic") return { api: "claude", model: name, id };
  if (vendor === "google") return { api: "gemini", model: name, id };
  if (vendor === "openai") return { api: "codex", model: name, id };
  if (vendor === "deepseek") return { api: "openai-responses", model: "deepseek-v4-1-flash", id };
  // Anything else KIE does not serve: the reliable default.
  return { ...KIE_MODELS["google/gemini-3.8-flash"], id: "google/gemini-3.8-flash" };
}

/** Reads pictures reliably on KIE (Gemini there often can't open them, 2026-11-25). */
const VISION_FIRST = "openai/gpt-6.1-sol";

/**
 * The plan's models on KIE, stand-ins applied, then the safety net, no
 * repeats. A request with pictures (and no sound) asks GPT-6.1 Sol before any
 * Gemini; sound stays on Gemini, the only one that hears.
 */
export function kieModelChain(
  models: string[],
  media: { images?: boolean; audio?: boolean } = {},
): KieTarget[] {
  const seen = new Set<string>();
  const out: KieTarget[] = [];
  let list = [...models, ...SAFETY_NET];
  if (media.images && !media.audio) {
    const firstGemini = list.findIndex((m) => kieTargetFor(m).api === "gemini");
    if (firstGemini >= 0)
      list = [...list.slice(0, firstGemini), VISION_FIRST, ...list.slice(firstGemini)];
  }
  for (const m of list) {
    const target = kieTargetFor(m);
    const key = `${target.api}:${target.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

function usdPerCredit(): number {
  const raw = Number(process.env.KIE_USD_PER_CREDIT);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.005;
}

function kieKey(): string {
  const key = process.env.KIE_API_KEY?.trim();
  if (!key) {
    throw new AiGatewayError(
      503,
      "AI service is not configured. Set KIE_API_KEY on the server.",
      "missing_api_key",
    );
  }
  return key;
}

/* ───────────────────────────── message shapes ───────────────────────────── */

type Part = {
  type: string;
  text?: string;
  image_url?: { url: string };
  input_audio?: { data: string; format: string };
  /** The same media in KIE's file store (set by hostMedia). */
  hostedUrl?: string;
};
type ToolCall = { id: string; type?: string; function: { name: string; arguments: string } };
type Msg = {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content?: string | Part[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

function partsOf(content: Msg["content"]): Part[] {
  if (content == null) return [];
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  return content;
}

function textOf(content: Msg["content"]): string {
  return partsOf(content)
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n\n");
}

/** What a model without a structured-output switch is told instead. */
function jsonInstruction(responseFormat: any): string | null {
  if (!responseFormat) return null;
  if (responseFormat.type === "json_schema") {
    const schema = responseFormat.json_schema?.schema ?? {};
    return [
      "Answer with ONE valid JSON object and nothing else: no prose, no code fences.",
      "It must match this JSON Schema exactly (every required key, the stated types):",
      JSON.stringify(schema),
    ].join("\n");
  }
  if (responseFormat.type === "json_object") {
    return "Answer with ONE valid JSON object and nothing else: no prose, no code fences.";
  }
  return null;
}

function effortOf(body: Record<string, any>): "low" | "medium" | "high" | null {
  const effort = body.reasoning?.effort;
  if (effort === "low" || effort === "medium" || effort === "high") return effort;
  return effort === "none" ? null : null;
}

function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  return match ? { mediaType: match[1], data: match[2] } : null;
}

/* ─────────────────────────────── Claude ─────────────────────────────── */

function claudeBody(target: KieTarget, body: Record<string, any>): Record<string, unknown> {
  const messages = (body.messages ?? []) as Msg[];
  const system: string[] = [];
  const out: { role: "user" | "assistant"; content: unknown[] }[] = [];
  const push = (role: "user" | "assistant", blocks: unknown[]) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: [...blocks] });
  };

  for (const m of messages) {
    if (m.role === "system" || m.role === "developer") {
      const text = textOf(m.content);
      if (text) system.push(text);
      continue;
    }
    if (m.role === "tool") {
      push("user", [
        {
          type: "tool_result",
          tool_use_id: m.tool_call_id ?? "",
          content: typeof m.content === "string" ? m.content : textOf(m.content),
        },
      ]);
      continue;
    }
    const blocks: unknown[] = [];
    for (const p of partsOf(m.content)) {
      if (p.type === "text" && p.text) blocks.push({ type: "text", text: p.text });
      else if (p.type === "image_url" && p.image_url?.url) {
        const data = parseDataUrl(p.image_url.url);
        blocks.push(
          data
            ? {
                type: "image",
                source: { type: "base64", media_type: data.mediaType, data: data.data },
              }
            : { type: "image", source: { type: "url", url: p.image_url.url } },
        );
      } else if (p.type === "input_audio") {
        // Claude does not hear; the next model in the chain (Gemini) does.
        throw new AiGatewayError(400, "Claude on KIE takes no audio.", "invalid_request");
      }
    }
    if (m.role === "assistant") {
      for (const call of m.tool_calls ?? []) {
        let input: unknown = {};
        try {
          input = JSON.parse(call.function.arguments || "{}");
        } catch {
          input = {};
        }
        blocks.push({ type: "tool_use", id: call.id, name: call.function.name, input });
      }
      push("assistant", blocks);
    } else {
      push("user", blocks);
    }
  }

  const json = jsonInstruction(body.response_format);
  if (json) system.push(json);
  const req: Record<string, unknown> = {
    model: target.model,
    messages: out,
    max_tokens: Math.min(Number(body.max_tokens) || 4096, 64_000),
    stream: false,
    // Thinking is off: KIE's thinking flag has no budget and would eat the
    // answer's tokens; Claude writes these pieces well without it.
    thinkingFlag: false,
  };
  if (system.length) req.system = system.join("\n\n");
  if (typeof body.temperature === "number") req.temperature = body.temperature;
  if (Array.isArray(body.tools) && body.tools.length) {
    req.tools = body.tools.map((t: any) => ({
      name: t.function?.name,
      description: t.function?.description ?? "",
      input_schema: t.function?.parameters ?? { type: "object", properties: {} },
    }));
  }
  return req;
}

function fromClaude(target: KieTarget, json: any): any {
  const blocks: any[] = Array.isArray(json?.content) ? json.content : [];
  const text = blocks
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
  const toolCalls: ToolCall[] = blocks
    .filter((b) => b?.type === "tool_use")
    .map((b) => ({
      id: String(b.id),
      type: "function",
      function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) },
    }));
  const stop = json?.stop_reason;
  const finish =
    stop === "max_tokens"
      ? "length"
      : stop === "tool_use" || toolCalls.length
        ? "tool_calls"
        : "stop";
  const u = json?.usage ?? {};
  const cached = Number(u.cache_read_input_tokens) || 0;
  const written = Number(u.cache_creation_input_tokens) || 0;
  return {
    id: json?.id,
    object: "chat.completion",
    model: target.id,
    choices: [
      {
        index: 0,
        finish_reason: finish,
        message: {
          role: "assistant",
          content: text || (toolCalls.length ? null : ""),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    usage: {
      prompt_tokens: (Number(u.input_tokens) || 0) + cached + written,
      completion_tokens: Number(u.output_tokens) || 0,
      prompt_tokens_details: { cached_tokens: cached, cache_write_tokens: written },
      ...costOf(json),
    },
  };
}

/* ─────────────────────────────── Gemini (OpenAI chat) ─────────────────────────────── */

function geminiBody(body: Record<string, any>): Record<string, unknown> {
  const json = jsonInstruction(body.response_format);
  const messages = ((body.messages ?? []) as Msg[]).map((m) => {
    const clean: Record<string, unknown> = { role: m.role === "developer" ? "system" : m.role };
    if (typeof m.content === "string" || m.content == null) clean.content = m.content ?? "";
    else {
      clean.content = m.content.map((p) => {
        if (p.type === "text") return { type: "text", text: p.text ?? "" };
        if (p.type === "image_url")
          return { type: "image_url", image_url: { url: p.image_url?.url } };
        if (p.type === "input_audio" && p.input_audio?.data && p.hostedUrl) {
          return { type: "image_url", image_url: { url: p.hostedUrl } };
        }
        if (p.type === "input_audio" && p.input_audio) {
          // KIE's Gemini takes every media file as image_url (its "unified media format").
          return {
            type: "image_url",
            image_url: { url: `data:audio/${p.input_audio.format};base64,${p.input_audio.data}` },
          };
        }
        return p;
      });
    }
    if (m.tool_calls) clean.tool_calls = m.tool_calls;
    if (m.tool_call_id) clean.tool_call_id = m.tool_call_id;
    return clean;
  });
  if (json) {
    const first = messages.findIndex((m) => m.role === "system" && typeof m.content === "string");
    if (first >= 0)
      messages[first] = { ...messages[first], content: `${messages[first].content}\n\n${json}` };
    else messages.unshift({ role: "system", content: json });
  }
  const req: Record<string, unknown> = { messages, stream: false };
  if (body.max_tokens) req.max_tokens = body.max_tokens;
  // KIE's Gemini answers 500 to `response_format`; the JSON rule is in the prompt instead.
  const effort = effortOf(body);
  req.reasoning_effort = effort ?? "low";
  if (typeof body.temperature === "number") req.temperature = body.temperature;
  if (Array.isArray(body.tools) && body.tools.length) req.tools = body.tools;
  return req;
}

function fromGemini(target: KieTarget, json: any): any {
  const choice = json?.choices?.[0];
  const message = choice?.message ?? {};
  const u = json?.usage ?? {};
  return {
    id: json?.id,
    object: "chat.completion",
    model: target.id,
    choices: [
      {
        index: 0,
        finish_reason: choice?.finish_reason ?? "stop",
        message: {
          role: "assistant",
          content: typeof message.content === "string" ? message.content : "",
          ...(Array.isArray(message.tool_calls) && message.tool_calls.length
            ? { tool_calls: message.tool_calls }
            : {}),
        },
      },
    ],
    usage: {
      prompt_tokens: Number(u.prompt_tokens) || 0,
      completion_tokens: Number(u.completion_tokens) || 0,
      prompt_tokens_details: { cached_tokens: Number(u.prompt_tokens_details?.cached_tokens) || 0 },
      completion_tokens_details: {
        reasoning_tokens: Number(u.completion_tokens_details?.reasoning_tokens) || 0,
      },
      ...costOf(json),
    },
  };
}

/* ─────────────────────────────── Responses (GPT, DeepSeek) ─────────────────────────────── */

function responsesBody(target: KieTarget, body: Record<string, any>): Record<string, unknown> {
  const input: unknown[] = [];
  for (const m of (body.messages ?? []) as Msg[]) {
    if (m.role === "system" || m.role === "developer") {
      const text = textOf(m.content);
      if (text) input.push({ role: "system", content: text });
      continue;
    }
    if (m.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: m.tool_call_id ?? "",
        output: typeof m.content === "string" ? m.content : textOf(m.content),
      });
      continue;
    }
    if (m.role === "assistant") {
      const text = textOf(m.content);
      if (text) input.push({ role: "assistant", content: [{ type: "output_text", text }] });
      for (const call of m.tool_calls ?? []) {
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments || "{}",
        });
      }
      continue;
    }
    const parts: unknown[] = [];
    for (const p of partsOf(m.content)) {
      if (p.type === "text" && p.text) parts.push({ type: "input_text", text: p.text });
      else if (p.type === "image_url" && p.image_url?.url) {
        if (target.api === "openai-responses") {
          throw new AiGatewayError(400, "DeepSeek on KIE reads no pictures.", "invalid_request");
        }
        parts.push({ type: "input_image", image_url: p.image_url.url });
      } else if (p.type === "input_audio") {
        throw new AiGatewayError(400, "This model on KIE takes no audio.", "invalid_request");
      }
    }
    if (parts.length) input.push({ role: "user", content: parts });
  }

  const req: Record<string, unknown> = { model: target.model, stream: false, input };
  if (body.max_tokens) req.max_output_tokens = body.max_tokens;
  const effort = effortOf(body);
  if (effort && target.api === "codex") req.reasoning = { effort };
  if (Array.isArray(body.tools) && body.tools.length) {
    req.tools = body.tools.map((t: any) => ({
      type: "function",
      name: t.function?.name,
      description: t.function?.description ?? "",
      parameters: t.function?.parameters ?? { type: "object", properties: {} },
    }));
    req.tool_choice = "auto";
  }
  const rf = body.response_format;
  if (rf?.type === "json_schema" && target.api === "codex") {
    req.text = {
      format: {
        type: "json_schema",
        name: rf.json_schema?.name ?? "answer",
        schema: rf.json_schema?.schema ?? {},
        strict: rf.json_schema?.strict ?? false,
      },
    };
  } else if (rf) {
    const json = jsonInstruction(rf);
    if (json) input.unshift({ role: "system", content: json });
    if (target.api === "codex") req.text = { format: { type: "json_object" } };
  }
  return req;
}

function fromResponses(target: KieTarget, json: any): any {
  const items: any[] = Array.isArray(json?.output) ? json.output : [];
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const item of items) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c?.type === "output_text" && typeof c.text === "string") text += c.text;
      }
    } else if (item?.type === "function_call") {
      toolCalls.push({
        id: String(item.call_id ?? item.id),
        type: "function",
        function: { name: String(item.name), arguments: String(item.arguments ?? "{}") },
      });
    }
  }
  const incomplete =
    json?.status === "incomplete" &&
    /max_output_tokens/.test(json?.incomplete_details?.reason ?? "");
  const u = json?.usage ?? {};
  return {
    id: json?.id,
    object: "chat.completion",
    model: target.id,
    choices: [
      {
        index: 0,
        finish_reason: incomplete ? "length" : toolCalls.length ? "tool_calls" : "stop",
        message: {
          role: "assistant",
          content: text || (toolCalls.length ? null : ""),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    usage: {
      prompt_tokens: Number(u.input_tokens) || 0,
      completion_tokens: Number(u.output_tokens) || 0,
      prompt_tokens_details: { cached_tokens: Number(u.input_tokens_details?.cached_tokens) || 0 },
      completion_tokens_details: {
        reasoning_tokens: Number(u.output_tokens_details?.reasoning_tokens) || 0,
      },
      ...costOf(json),
    },
  };
}

function costOf(json: any): { cost?: number } {
  const credits = Number(json?.credits_consumed);
  return Number.isFinite(credits) && credits >= 0
    ? { cost: Math.round(credits * usdPerCredit() * 1e6) / 1e6 }
    : {};
}

/* ─────────────────────────────── media ─────────────────────────────── */

/**
 * KIE's Gemini and GPT fetch media by URL and cannot open a base64 data URL
 * (checked live 2026-11-25: "I can't open this image file"). Every inline
 * picture or sound goes to KIE's own file store once per request.
 */
async function uploadToKie(dataUrl: string): Promise<string> {
  const mime = /^data:([^;,]+);/i.exec(dataUrl)?.[1] ?? "image/jpeg";
  const ext =
    mime
      .split("/")[1]
      ?.replace(/[^a-z0-9]/gi, "")
      .slice(0, 5) || "bin";
  const res = await fetch(KIE_UPLOAD, {
    method: "POST",
    headers: { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      base64Data: dataUrl,
      uploadPath: "mellox/llm-inputs",
      fileName: `${randomUUID()}.${ext === "jpeg" ? "jpg" : ext}`,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => null)) as {
    data?: { downloadUrl?: string };
    msg?: string;
  } | null;
  const url = json?.data?.downloadUrl;
  if (!res.ok || typeof url !== "string" || !/^https:\/\//i.test(url)) {
    throw new AiGatewayError(
      502,
      `KIE couldn't take the picture${json?.msg ? `: ${json.msg}` : "."}`,
      "provider_error",
    );
  }
  return url;
}

/** The body with every inline picture and sound replaced by a KIE file URL. */
export async function hostMedia(body: Record<string, any>): Promise<Record<string, any>> {
  const messages = (body.messages ?? []) as Msg[];
  const inline = messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some(
        (p) =>
          (p.type === "image_url" && p.image_url?.url?.startsWith("data:")) ||
          (p.type === "input_audio" && p.input_audio?.data),
      ),
  );
  if (!inline) return body;
  const uploads = new Map<string, Promise<string>>();
  const host = (dataUrl: string) => {
    const key = createHash("sha256").update(dataUrl).digest("hex");
    let pending = uploads.get(key);
    if (!pending) {
      pending = uploadToKie(dataUrl);
      uploads.set(key, pending);
    }
    return pending;
  };
  const hosted = await Promise.all(
    messages.map(async (m) => {
      if (!Array.isArray(m.content)) return m;
      const content = await Promise.all(
        m.content.map(async (p) => {
          if (p.type === "image_url" && p.image_url?.url?.startsWith("data:")) {
            return { ...p, image_url: { url: await host(p.image_url.url) } };
          }
          if (p.type === "input_audio" && p.input_audio?.data) {
            const url = await host(
              `data:audio/${p.input_audio.format};base64,${p.input_audio.data}`,
            );
            return { ...p, hostedUrl: url };
          }
          return p;
        }),
      );
      return { ...m, content };
    }),
  );
  return { ...body, messages: hosted };
}

function mediaIn(body: Record<string, any>): { images: boolean; audio: boolean } {
  let images = false;
  let audio = false;
  for (const m of (body.messages ?? []) as Msg[]) {
    if (!Array.isArray(m.content)) continue;
    for (const p of m.content) {
      if (p.type === "image_url") images = true;
      if (p.type === "input_audio") audio = true;
    }
  }
  return { images, audio };
}

/** A model that answered but never saw the media ("I can't open this image"). */
const BLIND_ANSWER =
  /\b(unable|can(?:'|no)t|couldn'?t|could not|not able)\b[^.]{0,30}\b(open|view|see|access|load|read)\b[^.]{0,40}\b(image|picture|file|photo|attachment|audio)/i;

/* ─────────────────────────────── sending ─────────────────────────────── */

function endpoint(target: KieTarget): string {
  switch (target.api) {
    case "claude":
      return `${KIE_API}/claude/v1/messages`;
    case "gemini":
      return `${KIE_API}/${target.model}-openai/v1/chat/completions`;
    case "codex":
      return `${KIE_API}/codex/v1/responses`;
    case "openai-responses":
      return `${KIE_API}/openai/v1/responses`;
  }
}

/** A KIE failure as a gateway error; `next` says another model may still answer. */
function kieError(
  status: number,
  payload: any,
  raw: string,
): { error: AiGatewayError; next: boolean } {
  const detail = String(
    payload?.msg ?? payload?.error?.message ?? payload?.message ?? raw ?? "",
  ).slice(0, 300);
  const code = Number(payload?.code) || status;
  if (code === 401 || /api key|unauthori[sz]ed/i.test(detail))
    return {
      error: new AiGatewayError(
        401,
        "KIE rejected the API key. Update KIE_API_KEY.",
        "invalid_api_key",
      ),
      next: false,
    };
  if (code === 402 || /insufficient|credits? (?:is|are) not enough|balance/i.test(detail))
    return {
      error: new AiGatewayError(
        402,
        "KIE is out of credits. Add credits at kie.ai, then retry.",
        "insufficient_credits",
      ),
      next: false,
    };
  if (/context|too long|maximum.*tokens/i.test(detail) && code === 400)
    return {
      error: new AiGatewayError(
        413,
        "The request is larger than the model's context window.",
        "context_exceeded",
      ),
      next: true,
    };
  if (code === 429)
    return {
      error: new AiGatewayError(
        429,
        "AI rate limit reached. Please try again in a moment.",
        "rate_limited",
      ),
      next: true,
    };
  if (/safety|content policy|moderation/i.test(detail))
    return {
      error: new AiGatewayError(422, "The AI model declined this request.", "refusal"),
      next: true,
    };
  if (code >= 500 || code === 0)
    return {
      error: new AiGatewayError(502, detail || "AI provider error", "provider_error"),
      next: true,
    };
  // 4xx: often one model's own rule (a field it refuses, "model not supported").
  return {
    error: new AiGatewayError(400, detail || "AI provider error", "invalid_request"),
    next: true,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tries per model: KIE's Claude answers intermittent 500s, so it gets one more go. */
function triesFor(target: KieTarget): number {
  return target.api === "claude" ? 2 : 1;
}

async function sendOnce(
  target: KieTarget,
  body: Record<string, any>,
  timeoutMs: number,
): Promise<any> {
  const req =
    target.api === "claude"
      ? claudeBody(target, body)
      : target.api === "gemini"
        ? geminiBody(body)
        : responsesBody(target, body);
  const res = await fetchWithTimeout(
    endpoint(target),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify(req),
    },
    {
      timeoutMs,
      onTransportError: ({ kind, detail }) =>
        kind === "timeout"
          ? new AiGatewayError(504, "AI provider timed out. Please retry.", "timeout")
          : new AiGatewayError(
              502,
              `Network error contacting AI provider: ${detail}`,
              "network_error",
            ),
    },
  );
  const raw = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }
  // KIE answers some failures with HTTP 200 and {"code": n, "msg": ...}.
  const kieCode = json && typeof json.code === "number" ? json.code : null;
  const anthropicError = json?.type === "error";
  if (!res.ok || anthropicError || (kieCode !== null && kieCode !== 200) || json?.error) {
    throw kieError(res.ok ? (kieCode ?? 502) : res.status, json, raw);
  }
  if (!json) {
    throw {
      error: new AiGatewayError(502, "AI provider returned malformed JSON.", "malformed_response"),
      next: true,
    };
  }
  const answer =
    target.api === "claude"
      ? fromClaude(target, json)
      : target.api === "gemini"
        ? fromGemini(target, json)
        : fromResponses(target, json);
  const message = answer.choices[0].message;
  if (
    !message.content &&
    !message.tool_calls?.length &&
    answer.choices[0].finish_reason !== "length"
  ) {
    throw {
      error: new AiGatewayError(502, "AI provider returned an empty answer.", "provider_error"),
      next: true,
    };
  }
  return answer;
}

/**
 * The KIE transport: the gateway's OpenRouter-shaped body in, an OpenAI
 * chat-completion out. Walks the model chain until one answers.
 */
export async function kieTransport(
  body: Record<string, unknown>,
  opts: TransportOpts,
): Promise<any> {
  const models = Array.isArray(body.models)
    ? (body.models as string[])
    : [String(body.model ?? "")];
  const media = mediaIn(body as Record<string, any>);
  const chain = kieModelChain(models.filter(Boolean), media);
  // The whole walk gets twice the caller's limit; one model never more than the limit.
  const deadline = Date.now() + opts.timeoutMs * 2;
  let lastError: AiGatewayError | null = null;
  // Claude takes base64 itself; the others get KIE file URLs (made once, on first need).
  let hostedBody: Promise<Record<string, any>> | null = null;

  for (const target of chain) {
    for (let attempt = 0; attempt < triesFor(target); attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 3_000) break;
      try {
        const sendBody =
          target.api === "claude"
            ? (body as Record<string, any>)
            : await (hostedBody ??= hostMedia(body as Record<string, any>));
        const answer = await sendOnce(target, sendBody, Math.min(opts.timeoutMs, remaining));
        const said = answer.choices?.[0]?.message?.content;
        if (
          (media.images || media.audio) &&
          typeof said === "string" &&
          BLIND_ANSWER.test(said.slice(0, 400))
        ) {
          throw {
            error: new AiGatewayError(502, "The model could not open the media.", "provider_error"),
            next: true,
          };
        }
        if (target.id !== kieTargetFor(models[0] ?? "").id) {
          log.warn("kie.chat.fallback", {
            route: opts.route,
            primary: models[0],
            answered: target.id,
          });
        }
        return answer;
      } catch (thrown) {
        const failure =
          thrown && typeof thrown === "object" && "error" in thrown && "next" in thrown
            ? (thrown as { error: AiGatewayError; next: boolean })
            : thrown instanceof AiGatewayError
              ? {
                  error: thrown,
                  // A timeout may already be billed; only move on when allowed.
                  next: thrown.code !== "timeout" || opts.retryOnTimeout !== false,
                }
              : {
                  error: new AiGatewayError(502, "AI provider error", "provider_error"),
                  next: true,
                };
        lastError = failure.error;
        log.warn("kie.chat.failed", {
          route: opts.route,
          model: target.id,
          attempt,
          code: failure.error.code,
          detail: failure.error.detail?.slice(0, 160),
        });
        if (!failure.next) throw failure.error;
        // A request this model refused won't pass on a second try.
        if (failure.error.code === "invalid_request" || failure.error.code === "context_exceeded")
          break;
        if (attempt + 1 < triesFor(target)) await sleep(600);
      }
    }
  }
  throw lastError ?? new AiGatewayError(502, "No KIE model could answer.", "provider_error");
}

/**
 * A finished answer as OpenAI-shape SSE, for the streaming chat path: KIE's
 * per-family streams differ, so chat gets the whole reply at once in the
 * exact event format the chat UI already reads.
 */
export function completionAsSse(answer: any): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const choice = answer?.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const base = { id: answer?.id ?? "kie", object: "chat.completion.chunk", model: answer?.model };
  const events: unknown[] = [];
  events.push({ ...base, choices: [{ index: 0, delta: { role: "assistant" } }] });
  const content = typeof message.content === "string" ? message.content : "";
  // A few chunks so the reply still appears progressively.
  const size = 160;
  for (let i = 0; i < content.length; i += size) {
    events.push({
      ...base,
      choices: [{ index: 0, delta: { content: content.slice(i, i + size) } }],
    });
  }
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    events.push({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: message.tool_calls.map((call: ToolCall, index: number) => ({
              index,
              id: call.id,
              type: "function",
              function: { name: call.function.name, arguments: call.function.arguments },
            })),
          },
        },
      ],
    });
  }
  events.push({
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason ?? "stop" }],
  });
  events.push({ ...base, choices: [], usage: answer?.usage });
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}
