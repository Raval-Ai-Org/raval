"use client";

// Tracked prompts: the questions this brand wants to be the answer to, and
// whether each answer engine names it. Checked weekly (included in the plan);
// "Check now" costs credits. Answers come from each engine's model through its
// API, which can differ from what a person sees in the app.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tile, GroupLabel } from "@/components/app/surface/SurfaceLayout";
import { CostChip } from "@/components/app/CostChip";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, MessageSquare, Pause, Play, Plus, RefreshCw, Trash, X } from "@/components/icons";
import { emitAppEvent } from "@/lib/app-events";
import {
  addTrackedPrompt,
  checkTrackedPromptNow,
  deleteTrackedPrompt,
  getTrackedPrompts,
  setTrackedPromptPaused,
  suggestTrackedPrompts,
  type TrackedPromptView,
} from "@/lib/tracked-prompts.functions";
import { cn } from "@/lib/utils";
import { ghostBtn, primaryBtn, relativeTime } from "./geo-ui";

const ENGINE_LABEL: Record<string, string> = {
  perplexity: "Perplexity",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  google_aio: "AI Overviews",
};

export function PromptsTab({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const key = ["geo", "tracked-prompts", workspaceId];
  const overview = useQuery({
    queryKey: key,
    queryFn: () => getTrackedPrompts({ data: { workspaceId } }),
  });
  const suggestions = useQuery({
    queryKey: ["geo", "tracked-prompts", "suggest", workspaceId],
    queryFn: () => suggestTrackedPrompts({ data: { workspaceId } }),
  });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["geo", "tracked-prompts"] });
    emitAppEvent("billing:changed");
  };

  async function run(id: string, work: () => Promise<unknown>, done?: string) {
    setBusy(id);
    try {
      await work();
      if (done) toast.success(done);
      refresh();
    } catch (cause) {
      // Plan limits and empty balances already show a toast with options.
      const status = (cause as { status?: number }).status;
      if (status !== 402) toast.error(cause instanceof Error ? cause.message : "Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (overview.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }
  if (overview.error || !overview.data) {
    return (
      <ErrorState
        title="Tracked prompts aren't available"
        description={overview.error?.message}
        onRetry={() => void overview.refetch()}
      />
    );
  }
  const { prompts, used, limit, engines, webSearch } = overview.data;
  const full = used >= limit;
  const add = (value: string) =>
    run(
      "add",
      async () => {
        await addTrackedPrompt({ data: { workspaceId, text: value } });
        setText("");
      },
      "Added. It's checked in the next few minutes, then every week.",
    );

  return (
    <div className="space-y-5">
      <Tile className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
          <span className="text-muted-foreground">
            Checked every week on{" "}
            {engines.map((engine) => ENGINE_LABEL[engine] ?? engine).join(", ")}
            {webSearch ? "" : " (model answers)"}
          </span>
          <span className={cn("font-semibold tabular-nums", full && "text-warning")}>
            {used} / {limit} prompts
          </span>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim().length >= 3) void add(text.trim());
          }}
        >
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={300}
            placeholder="A question your customers ask, e.g. best CRM for small agencies"
            aria-label="New tracked prompt"
            className="h-10 min-w-0 flex-1 rounded-full bg-[var(--ds-well-bg)] px-4 text-[13.5px] outline-none ring-primary/40 placeholder:text-muted-foreground focus-visible:ring-2"
          />
          {full ? (
            <button
              type="button"
              onClick={() =>
                emitAppEvent("open:upgrade", {
                  code: "limit_reached",
                  limit: "trackedPrompts",
                  used,
                  max: limit,
                })
              }
              className={cn(primaryBtn, "h-10 px-4 text-[13px]")}
            >
              Get more
            </button>
          ) : (
            <button
              type="submit"
              disabled={busy !== null || text.trim().length < 3}
              className={cn(primaryBtn, "h-10 px-4 text-[13px]")}
            >
              <Plus className="h-4 w-4" /> Track
            </button>
          )}
        </form>
        {!!suggestions.data?.suggestions.length && !full && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.data.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={busy !== null}
                onClick={() => void add(suggestion)}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--ds-well-bg)] px-3 py-1.5 text-[12.5px] hover:bg-[var(--ds-well-bg-hover)] disabled:opacity-50"
              >
                <Plus className="h-3 w-3" /> {suggestion}
              </button>
            ))}
          </div>
        )}
      </Tile>

      {prompts.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          size="sm"
          title="No prompts yet"
          description="Add the questions you want AI answers to name your brand for."
        />
      ) : (
        <div>
          <GroupLabel>Your prompts</GroupLabel>
          <div className="space-y-2.5">
            {prompts.map((prompt) => (
              <PromptRow
                key={prompt.id}
                prompt={prompt}
                engines={engines}
                busy={busy}
                onCheck={() =>
                  run(
                    `check:${prompt.id}`,
                    () =>
                      checkTrackedPromptNow({
                        data: {
                          workspaceId,
                          promptId: prompt.id,
                          idempotencyKey: crypto.randomUUID(),
                        },
                      }),
                    "Checked.",
                  )
                }
                onPause={() =>
                  run(`pause:${prompt.id}`, () =>
                    setTrackedPromptPaused({
                      data: { workspaceId, promptId: prompt.id, paused: !prompt.paused },
                    }),
                  )
                }
                onDelete={() =>
                  run(`delete:${prompt.id}`, () =>
                    deleteTrackedPrompt({ data: { workspaceId, promptId: prompt.id } }),
                  )
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PromptRow({
  prompt,
  engines,
  busy,
  onCheck,
  onPause,
  onDelete,
}: {
  prompt: TrackedPromptView;
  engines: string[];
  busy: string | null;
  onCheck: () => void;
  onPause: () => void;
  onDelete: () => void;
}) {
  const byEngine = new Map(prompt.latest.map((check) => [check.engine, check]));
  return (
    <Tile className={cn("space-y-3", prompt.paused && "opacity-70")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[14px] font-medium">{prompt.text}</p>
          <p className="text-[12px] text-muted-foreground">
            {prompt.paused
              ? "Paused"
              : prompt.lastCheckedAt
                ? `Checked ${relativeTime(prompt.lastCheckedAt)}`
                : "First check in a few minutes"}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {!prompt.paused && <CostChip action="prompt_check_3_engines" />}
          <button
            type="button"
            disabled={busy !== null || prompt.paused}
            onClick={onCheck}
            className={cn(ghostBtn, "h-8 px-3 text-[12.5px]")}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", busy === `check:${prompt.id}` && "animate-spin")}
            />
            Check now
          </button>
          <button
            type="button"
            aria-label={prompt.paused ? "Resume" : "Pause"}
            disabled={busy !== null}
            onClick={onPause}
            className={cn(ghostBtn, "h-8 w-8 px-0")}
          >
            {prompt.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            aria-label="Delete"
            disabled={busy !== null}
            onClick={onDelete}
            className={cn(ghostBtn, "h-8 w-8 px-0")}
          >
            <Trash className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {engines.map((engine) => {
          const check = byEngine.get(engine as never);
          const state = !check ? "none" : check.error ? "error" : check.mentioned ? "yes" : "no";
          return (
            <span
              key={engine}
              title={check?.excerpt ?? undefined}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px]",
                state === "yes" && "bg-success/12 text-success",
                state === "no" && "bg-foreground/[0.06] text-muted-foreground",
                state === "error" && "bg-warning/12 text-warning",
                state === "none" && "bg-foreground/[0.04] text-muted-foreground",
              )}
            >
              {state === "yes" ? (
                <Check className="h-3 w-3" strokeWidth={2.6} />
              ) : state === "no" ? (
                <X className="h-3 w-3" />
              ) : null}
              {ENGINE_LABEL[engine] ?? engine}
              {state === "yes" && check?.position ? ` · #${check.position}` : ""}
              {state === "error" ? " · try again" : ""}
            </span>
          );
        })}
        {prompt.trend.length > 1 && <Trend points={prompt.trend} />}
      </div>
    </Tile>
  );
}

/** Tiny weekly bars: the share of engines that named the brand. */
function Trend({ points }: { points: Array<{ week: string; rate: number }> }) {
  return (
    <span className="ml-auto flex h-5 items-end gap-0.5" aria-label="Mentions by week">
      {points.map((point) => (
        <span
          key={point.week}
          title={`${point.week}: ${Math.round(point.rate * 100)}%`}
          className="w-1.5 rounded-sm bg-primary/70"
          style={{ height: `${Math.max(12, Math.round(point.rate * 100))}%` }}
        />
      ))}
    </span>
  );
}
