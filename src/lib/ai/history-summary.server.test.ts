import { beforeEach, describe, expect, it, vi } from "vitest";

const chatCompletion = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai-gateway.server", () => ({
  chatCompletion,
  FAST_CHAT_MODEL: "fast-model",
}));

import { summarizeHistory, summarizedTurnCount } from "./history-summary.server";
import type { ChatTurn } from "./history-compact";

const turns = (n: number): ChatTurn[] =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `turn ${i}`,
  }));

const transcriptSent = (call: number) =>
  chatCompletion.mock.calls[call][0].messages[1].content as string;

beforeEach(() => {
  chatCompletion.mockReset();
  chatCompletion.mockResolvedValue({ choices: [{ message: { content: "- Decisions: x" } }] });
});

describe("summarizeHistory", () => {
  it("sends conversations shorter than one bucket past the tail verbatim, with no model call", async () => {
    const history = turns(19);
    await expect(summarizeHistory(history)).resolves.toEqual(history);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("summarises whole buckets so consecutive turns reuse one identical request", async () => {
    for (const n of [20, 21, 22, 27]) await summarizeHistory(turns(n));
    const sent = chatCompletion.mock.calls.map((_, i) => transcriptSent(i));
    expect(new Set(sent).size).toBe(1);
    expect(sent[0]).toContain("turn 7");
    expect(sent[0]).not.toContain("turn 8");

    await summarizeHistory(turns(28));
    expect(transcriptSent(4)).toContain("turn 15");
  });

  it("keeps every turn after the summarised bucket verbatim", async () => {
    const history = turns(23);
    const out = await summarizeHistory(history);
    expect(out[0]).toMatchObject({ role: "system" });
    expect(out.slice(1)).toEqual(history.slice(8));
    expect(summarizedTurnCount(23)).toBe(8);
  });

  it("falls back to heuristic compaction over the same split when the model fails", async () => {
    chatCompletion.mockRejectedValue(new Error("provider down"));
    const history = turns(23);
    const out = await summarizeHistory(history);
    expect(String(out[0].content)).toContain("compact");
    expect(out.slice(1)).toEqual(history.slice(8));
  });
});
