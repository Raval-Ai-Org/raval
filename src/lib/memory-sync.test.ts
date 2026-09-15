import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as { role: string; content: string; created_at: string }[],
  fetch: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: state.rows, error: null });
  return { supabase: { from: () => chain } };
});

vi.mock("@/lib/authed-fetch", () => ({ authedFetch: state.fetch }));

import { CONTEXT_OVERLAP, nextWatermarks, selectNewTurns, syncMemoryFromChat } from "./memory-sync";

const at = (i: number) => new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString();
const LONG = "We only sell to dental clinics in Ontario and never discount annual plans.";

function dna(syncedAt?: Record<string, number>) {
  return {
    brandName: "Acme",
    oneLiner: "",
    userInsights: [],
    competitors: [],
    customer: { triggerSignals: [], objectionSignals: [], feedbackSources: [] },
    memorySyncedAt: syncedAt,
  } as never;
}

beforeEach(() => {
  state.fetch.mockReset();
  state.fetch.mockResolvedValue(
    new Response(JSON.stringify({ insights: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  // The query returns newest first, like order("created_at", { ascending: false }).
  state.rows = Array.from({ length: 6 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `${LONG} (turn ${i})`,
    created_at: at(i),
  })).reverse();
});

describe("memory sync selection", () => {
  it("sends only turns newer than the watermark plus a little context", () => {
    const turns = [0, 1, 2, 3, 4, 5].map((i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: LONG,
      at: i,
    }));
    const selection = selectNewTurns(turns, 3)!;
    expect(selection.send.map((t) => t.at)).toEqual([2, 3, 4, 5]);
    expect(selection.send).toHaveLength(2 + CONTEXT_OVERLAP);
    expect(selection.newest).toBe(5);
    expect(selectNewTurns(turns, 5)).toBeNull();
  });

  it("keeps a bounded set of the most recent watermarks", () => {
    let marks: Record<string, number> = {};
    for (let i = 0; i < 60; i++) marks = nextWatermarks(marks, `c${i}`, i);
    expect(Object.keys(marks)).toHaveLength(50);
    expect(marks.c59).toBe(59);
    expect(marks.c0).toBeUndefined();
  });
});

describe("syncMemoryFromChat", () => {
  it("extracts the newest turns only and advances the watermark", async () => {
    const save = vi.fn();
    await syncMemoryFromChat("ws", dna({ c1: Date.parse(at(3)) }), save, "c1");

    expect(state.fetch).toHaveBeenCalledOnce();
    const body = JSON.parse(state.fetch.mock.calls[0][1].body as string);
    expect(body.messages.map((m: { content: string }) => m.content.slice(-8))).toEqual([
      "(turn 2)",
      "(turn 3)",
      "(turn 4)",
      "(turn 5)",
    ]);
    expect(save.mock.calls[0][0].memorySyncedAt).toEqual({ c1: Date.parse(at(5)) });
  });

  it("makes no model call when nothing is new", async () => {
    const save = vi.fn();
    const res = await syncMemoryFromChat("ws", dna({ c1: Date.parse(at(5)) }), save, "c1");
    expect(res.skipped).toBe("no new messages");
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("skips the model call for trivial new messages but still advances the watermark", async () => {
    state.rows[0] = { role: "assistant", content: "You're welcome!", created_at: at(5) };
    state.rows[1] = { role: "user", content: "thanks", created_at: at(4) };
    const save = vi.fn();
    const res = await syncMemoryFromChat("ws", dna({ c1: Date.parse(at(3)) }), save, "c1");
    expect(res.skipped).toBe("nothing substantive");
    expect(state.fetch).not.toHaveBeenCalled();
    expect(save.mock.calls[0][0].memorySyncedAt).toEqual({ c1: Date.parse(at(5)) });
  });
});
