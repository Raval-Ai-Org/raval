"use client";

// Insights — what changed (deterministic, computed from your data) and what
// it means (AI, generated only when the changes are new, then cached).
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { ArrowDown, ArrowUp, Lightbulb, MessageSquare, Sparkles } from "@/components/icons";
import { formatWindow } from "@/lib/analytics/ranges";
import type { Signal } from "@/lib/analytics/signals";
import { DATA_SOURCES, type DataSource } from "@/lib/analytics/sources";
import type { InsightItem } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";
import { useInsights, useRefreshInsights } from "./hooks";
import { ReportError, ReportSkeleton } from "./SourceGate";
import { askMellox, Card, SourceBadge } from "./ui";

const SEVERITY: Record<InsightItem["severity"], { label: string; cls: string }> = {
  positive: { label: "Good news", cls: "bg-success/10 text-success ring-success/25" },
  watch: { label: "Keep an eye on", cls: "bg-warning/10 text-warning ring-warning/25" },
  negative: {
    label: "Needs attention",
    cls: "bg-destructive/10 text-destructive ring-destructive/25",
  },
};

function SignalRow({ s }: { s: Signal }) {
  const Arrow = s.direction === "up" ? ArrowUp : ArrowDown;
  return (
    <li className="flex items-start gap-2 py-2 text-[12.5px]">
      <Arrow
        className={cn(
          "mt-0.5 h-3.5 w-3.5 shrink-0",
          s.favorable ? "text-success" : "text-destructive",
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1">{s.fact}</span>
      <span className="sr-only">{s.favorable ? "better" : "worse"}</span>
    </li>
  );
}

function insightPrompt(item: InsightItem, signals: Signal[]): string {
  const facts = signals.filter((s) => item.signalIds.includes(s.id)).map((s) => `- ${s.fact}`);
  return `About my ${DATA_SOURCES[item.source].label} data: "${item.title}".\n${facts.join("\n")}\nExplain why this may be happening and give me a short plan for this week.`;
}

function InsightCard({ item, signals }: { item: InsightItem; signals: Signal[] }) {
  const sev = SEVERITY[item.severity];
  const cited = signals.filter((s) => item.signalIds.includes(s.id));
  return (
    <li className="rounded-2xl border border-border bg-card/70 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1", sev.cls)}>
          {sev.label}
        </span>
        <SourceBadge source={item.source} />
      </div>
      <h4 className="mt-2 text-[14px] font-semibold tracking-tight">{item.title}</h4>
      <p className="mt-1 text-[12.5px] leading-relaxed text-foreground/85">{item.summary}</p>
      {cited.length > 0 && (
        <ul className="mt-2 divide-y divide-border/50 rounded-xl bg-muted/30 px-3">
          {cited.map((s) => (
            <SignalRow key={s.id} s={s} />
          ))}
        </ul>
      )}
      <div className="mt-3 flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/5 p-2.5 text-[12.5px]">
        <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        <span>{item.recommendation}</span>
      </div>
      <button
        type="button"
        onClick={() => askMellox(insightPrompt(item, signals))}
        className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground"
      >
        <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Ask Mellox about this
      </button>
    </li>
  );
}

export function InsightsPanel() {
  const ws = useWorkspace();
  const { data, isLoading, error, refetch } = useInsights();
  const refresh = useRefreshInsights();
  const canEdit = ws.role !== "viewer";

  if (isLoading && !data) return <ReportSkeleton />;
  if (error && !data) return <ReportError error={error} onRetry={() => void refetch()} />;
  if (!data) return null;

  const bySource = new Map<DataSource, Signal[]>();
  for (const s of data.signals) bySource.set(s.source, [...(bySource.get(s.source) ?? []), s]);
  const items = data.insight?.items ?? data.stale?.items ?? [];

  return (
    <div className="space-y-4">
      <Card
        title="What it means"
        window={data.window}
        action={
          data.canGenerate && canEdit ? (
            <Button
              size="sm"
              className="gap-1.5"
              loading={refresh.isPending}
              onClick={() =>
                refresh.mutate(undefined, {
                  onError: (e) =>
                    toast.error(e instanceof Error ? e.message : "Couldn't create insights"),
                })
              }
            >
              {!refresh.isPending && <Sparkles className="h-3.5 w-3.5" aria-hidden />}
              {data.stale ? "Update insights" : "Explain these changes"}
            </Button>
          ) : null
        }
      >
        {data.signals.length === 0 ? (
          <EmptyState
            size="sm"
            icon={Lightbulb}
            title="No big changes"
            description="Nothing moved enough to call out for this period."
          />
        ) : items.length === 0 ? (
          <p className="py-4 text-center text-[12.5px] text-muted-foreground">
            {canEdit
              ? "Mellox can explain the changes below."
              : "No explanation yet. An editor can create one."}
          </p>
        ) : (
          <>
            {!data.insight && data.stale && (
              <p className="mb-3 text-[11.5px] text-muted-foreground">
                Your numbers changed since this was written on{" "}
                {new Date(data.stale.createdAt).toLocaleDateString()}.
              </p>
            )}
            <ul className="grid gap-3 lg:grid-cols-2">
              {items.map((item, i) => (
                <InsightCard key={`${item.title}-${i}`} item={item} signals={data.signals} />
              ))}
            </ul>
          </>
        )}
      </Card>

      {data.signals.length > 0 && (
        <Card title="What changed" window={data.window}>
          <div className="grid gap-4 md:grid-cols-2">
            {[...bySource.entries()].map(([source, signals]) => (
              <div key={source}>
                <SourceBadge source={source} />
                <ul className="mt-1 divide-y divide-border/50">
                  {signals.map((s) => (
                    <SignalRow key={s.id} s={s} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10.5px] text-muted-foreground">
            Compared with {formatWindow(data.window.previous)}. Only changes big enough to matter
            are listed.
          </p>
        </Card>
      )}
    </div>
  );
}
