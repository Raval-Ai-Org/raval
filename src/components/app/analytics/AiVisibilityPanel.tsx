"use client";

// AI Visibility — the Mellox scan score (0–100): how ready the site is to be
// read and cited by AI answers. A readiness score, not traffic; it is never
// combined with GA4 or Search Console numbers.
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Target } from "@/components/icons";
import { MiniBar, ScoreRing, scoreTone } from "@/components/app/geo/geo-ui";
import { emitAppEvent } from "@/lib/app-events";
import { useAnalyticsReport } from "./hooks";
import { ReportError, ReportSkeleton } from "./SourceGate";
import { AskButton, Card, DeltaChip } from "./ui";

export function AiVisibilityPanel() {
  const { data, isLoading, error, refetch } = useAnalyticsReport("ai-visibility");
  if (isLoading && !data) return <ReportSkeleton />;
  if (error && !data) return <ReportError error={error} onRetry={() => void refetch()} />;
  if (!data) return null;

  if (!data.latest) {
    return (
      <EmptyState
        icon={Target}
        title="No AI Visibility scan yet"
        description="Scan your site to see how ready it is for AI answers."
        action={
          <Button onClick={() => emitAppEvent("open:ai-visibility")}>Open AI Visibility</Button>
        }
        className="rounded-2xl border border-border bg-card/60"
      />
    );
  }

  const latest = data.latest;
  const history = data.history.map((h) => ({ at: h.date, score: h.score }));

  return (
    <div className="space-y-4">
      <Card
        title="AI Visibility score"
        source="geo"
        action={
          <Button size="sm" variant="outline" onClick={() => emitAppEvent("open:ai-visibility")}>
            Open AI Visibility
          </Button>
        }
      >
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
          <ScoreRing value={latest.score} size={120} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
              <span>Last scan {new Date(latest.scannedAt).toLocaleDateString()}</span>
              {latest.url && (
                <span className="truncate">· {latest.url.replace(/^https?:\/\//, "")}</span>
              )}
            </div>
            <DeltaChip metric="geo.score" c={data.kpi.comparison} />
            <ul className="grid gap-2 pt-1 sm:grid-cols-2">
              {latest.categories.map((c) => (
                <li key={c.id} className="text-[12px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{c.name}</span>
                    <span className="tabular-nums text-muted-foreground">{c.score}</span>
                  </div>
                  <MiniBar value={c.score} tone={scoreTone(c.score)} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      {history.length > 1 && (
        <Card title="Score over time" source="geo">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <CartesianGrid
                  stroke="hsl(var(--border))"
                  strokeDasharray="3 3"
                  vertical={false}
                  opacity={0.5}
                />
                <XAxis
                  dataKey="at"
                  tickFormatter={(v: string) =>
                    new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  }
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={10.5}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                <YAxis
                  domain={[0, 100]}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={10.5}
                  tickLine={false}
                  axisLine={false}
                  width={34}
                />
                <Tooltip
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <div className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11.5px] shadow-md">
                        {new Date((payload[0].payload as { at: string }).at).toLocaleString()}:{" "}
                        {payload[0].value}/100
                      </div>
                    ) : null
                  }
                />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {data.probes && (
          <Card title="Mentions in AI answers" source="geo">
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="rounded-xl border border-border/70 p-3">
                <div className="text-2xl font-semibold tabular-nums">
                  {Math.round(data.probes.mentionRate * 100)}%
                </div>
                <div className="text-[11px] text-muted-foreground">answers that name you</div>
              </div>
              <div className="rounded-xl border border-border/70 p-3">
                <div className="text-2xl font-semibold tabular-nums">
                  {Math.round(data.probes.citationRate * 100)}%
                </div>
                <div className="text-[11px] text-muted-foreground">answers that link to you</div>
              </div>
            </div>
            <p className="mt-2 text-[10.5px] text-muted-foreground">
              From {data.probes.answers} test questions on{" "}
              {new Date(data.probes.ranAt).toLocaleDateString()}.
            </p>
          </Card>
        )}
        {data.topActions.length > 0 && (
          <Card
            title="What to fix first"
            source="geo"
            action={
              <AskButton
                prompt="Help me fix the top issues from my AI Visibility scan."
                label="Ask Mellox"
              />
            }
          >
            <ul className="space-y-2">
              {data.topActions.map((a) => (
                <li key={a.id} className="rounded-xl border border-border/60 p-2.5 text-[12px]">
                  <div className="font-medium">{a.title}</div>
                  <div className="mt-0.5 line-clamp-2 text-muted-foreground">{a.detail}</div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
