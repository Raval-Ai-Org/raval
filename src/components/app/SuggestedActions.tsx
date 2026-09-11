"use client";

// Suggested actions from a chat reply — the approval boundary made visible.
// The model may PROPOSE saving a memory, drafting a scheduled post or running
// an audit; nothing happens until the user approves that specific action.
// States: Suggested → Executing → Executed / Failed, or Dismissed.
import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import {
  describeSuggestion,
  type ChatToolCall,
  type ChatToolResult,
} from "@/lib/chat-tools";

type State = "suggested" | "executing" | "executed" | "failed" | "dismissed";

export function SuggestedActions({
  suggestions,
  execute,
}: {
  suggestions: ChatToolCall[];
  execute: (call: ChatToolCall) => Promise<ChatToolResult>;
}) {
  const [states, setStates] = useState<State[]>(() => suggestions.map(() => "suggested"));
  const [results, setResults] = useState<(ChatToolResult | null)[]>(() =>
    suggestions.map(() => null),
  );

  const set = (i: number, s: State, r?: ChatToolResult) => {
    setStates((prev) => prev.map((v, j) => (j === i ? s : v)));
    if (r) setResults((prev) => prev.map((v, j) => (j === i ? r : v)));
  };

  const approve = async (i: number) => {
    set(i, "executing");
    try {
      const r = await execute(suggestions[i]);
      set(i, r.ok ? "executed" : "failed", r);
    } catch (e) {
      set(i, "failed", {
        kind: suggestions[i].kind,
        ok: false,
        label: "Action failed",
        detail: e instanceof Error ? e.message : undefined,
      });
    }
  };

  if (!suggestions.length) return null;
  return (
    <div
      className="mt-1 flex flex-col gap-2 rounded-xl border border-border/60 bg-card/60 p-3"
      role="group"
      aria-label="Suggested actions awaiting your approval"
    >
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Suggested — needs your approval
      </div>
      {suggestions.map((call, i) => {
        const { title, effect } = describeSuggestion(call);
        const state = states[i];
        const result = results[i];
        return (
          <div
            key={`${call.kind}-${i}`}
            className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border/50 bg-background/60 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-foreground">{title}</div>
              <div className="text-[12px] text-muted-foreground">
                {state === "executed" || state === "failed"
                  ? `${result?.label ?? ""}${result?.detail ? ` — ${result.detail}` : ""}`
                  : state === "dismissed"
                    ? "Dismissed — nothing was changed."
                    : effect}
              </div>
            </div>
            {state === "suggested" ? (
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => void approve(i)}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground hover:opacity-90"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden /> Approve
                </button>
                <button
                  type="button"
                  onClick={() => set(i, "dismissed")}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" aria-hidden /> Dismiss
                </button>
              </div>
            ) : (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  state === "executed"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : state === "failed"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {state === "executing" ? (
                  <Loader2 className="inline h-3 w-3 animate-spin" aria-label="Executing" />
                ) : state === "executed" ? (
                  "Executed"
                ) : state === "failed" ? (
                  "Failed"
                ) : (
                  "Dismissed"
                )}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
