// trimMessages allocates the input budget by priority, not array order.
//
// Regression guard for the bug where the budget was spent front-to-back, so the
// current user question (always last) was truncated to 200 chars while stale
// history survived intact.
import { describe, it, expect } from "vitest";
import { trimMessages, type ChatMessage } from "./ai-gateway.server";

const sys = (content: string): ChatMessage => ({ role: "system", content });
const user = (content: string): ChatMessage => ({ role: "user", content });
const bot = (content: string): ChatMessage => ({ role: "assistant", content });
const text = (n: number, ch = "x") => ch.repeat(n);

describe("trimMessages", () => {
  it("leaves everything untouched when the conversation fits", () => {
    const messages = [sys("rules"), user("hello"), bot("hi")];

    expect(trimMessages(messages, 1000)).toEqual(messages);
  });

  it("preserves message order and count", () => {
    const messages = [sys(text(300)), user(text(300)), bot(text(300)), user(text(300))];

    const out = trimMessages(messages, 500);

    expect(out).toHaveLength(4);
    expect(out.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  });

  it("keeps the newest question intact and sacrifices old history instead", () => {
    // The regression: 12 turns of history plus a long current question.
    const history: ChatMessage[] = [];
    for (let i = 0; i < 6; i++) {
      history.push(user(text(1200, "q")), bot(text(1200, "a")));
    }
    const question = text(3000, "Q");
    const messages = [sys(text(1300, "s")), sys(text(6000, "c")), ...history, user(question)];

    const out = trimMessages(messages, 16_000);

    // The current question survives in full...
    expect(out[out.length - 1].content).toBe(question);
    // ...and the oldest exchange is what got cut instead.
    expect((out[2].content as string).length).toBeLessThan(1200);
  });

  it("never truncates the newest turn to a 200-char stub (the original bug)", () => {
    const question = text(1500, "Q");
    const messages = [
      sys(text(5000, "s")),
      ...Array.from({ length: 10 }, () => bot(text(2000, "a"))),
      user(question),
    ];

    const out = trimMessages(messages, 16_000);

    expect((out[out.length - 1].content as string).length).toBeGreaterThan(200);
  });

  it("protects the system prompt from being starved by long history", () => {
    const rules = text(2000, "s");
    const messages = [
      sys(rules),
      ...Array.from({ length: 20 }, () => user(text(2000, "h"))),
      user(text(2000, "Q")),
    ];

    const out = trimMessages(messages, 8_000);

    // The system block keeps its full content — it holds the grounding rules
    // and action-tag contract the app parses out of the response.
    expect(out[0].content).toBe(rules);
  });

  it("caps a runaway system block so it cannot consume the whole budget", () => {
    const messages = [sys(text(50_000, "s")), user(text(2000, "Q"))];

    const out = trimMessages(messages, 10_000);

    expect((out[0].content as string).length).toBeLessThanOrEqual(6_000); // 60% of 10k
    expect((out[1].content as string).length).toBeGreaterThan(200);
  });

  it("passes through non-string content (multimodal parts) unchanged", () => {
    const multimodal: ChatMessage = {
      role: "user",
      content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }],
    };

    const out = trimMessages([sys(text(500)), multimodal], 100);

    expect(out[1]).toBe(multimodal);
  });

  it("keeps every turn represented even when far over budget", () => {
    const messages = [sys(text(9000)), user(text(9000)), bot(text(9000)), user(text(9000))];

    const out = trimMessages(messages, 1_000);

    for (const m of out) {
      expect((m.content as string).length).toBeGreaterThan(0);
    }
  });

  it("handles a conversation with no system messages", () => {
    const question = text(800, "Q");
    const messages = [user(text(5000, "h")), bot(text(5000, "a")), user(question)];

    const out = trimMessages(messages, 4_000);

    expect(out[out.length - 1].content).toBe(question);
  });
});
