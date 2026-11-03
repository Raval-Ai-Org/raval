"use client";

// Social — how the brand's posts do on its connected accounts, from the
// numbers each network reports (read through Post for Me's account feed).
// No Google connection needed. Posts made outside Mellox count too and are
// marked as such. A number a network doesn't report says so; it is never 0.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Heart, Loader2, RefreshCw, Settings } from "@/components/icons";
import {
  isPlatformAppIconId,
  PlatformAppIcon,
  platformAppIconLabel,
} from "@/components/brand/PlatformAppIcon";
import { Segmented } from "@/components/app/geo/geo-ui";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { emitAppEvent } from "@/lib/app-events";
import { formatMetric, type MetricKey } from "@/lib/analytics/metrics";
import type { SocialGroupRow, SocialPostRow, SocialReport } from "@/lib/analytics/types";
import { syncSocialMetrics } from "@/lib/sdr.functions";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { analyticsKeys, useAnalyticsReport } from "./hooks";
import { ReportError, ReportSkeleton } from "./SourceGate";
import { askMellox, Card, fmt, KpiGrid, kpiPrompt, TrendChart } from "./ui";

const TREND = [
  { id: "views", label: "Views", metric: "social.views" },
  { id: "engagement", label: "Interactions", metric: "social.engagement" },
  { id: "posts", label: "Posts", metric: "social.posts" },
] as const satisfies ReadonlyArray<{
  id: keyof SocialReport["series"];
  label: string;
  metric: MetricKey;
}>;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FORMAT_LABEL: Record<string, string> = {
  video: "Videos",
  image: "Pictures",
  text: "Text posts",
  post: "Other posts",
};

export function platformName(platform: string): string {
  return isPlatformAppIconId(platform) ? platformAppIconLabel(platform) : platform;
}

export function PlatformCell({ platform, size = 18 }: { platform: string; size?: number }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {isPlatformAppIconId(platform) ? <PlatformAppIcon platform={platform} size={size} /> : null}
      <span className="truncate">{platformName(platform)}</span>
    </span>
  );
}

const pct = (v: number | null) => (v === null ? "—" : formatMetric("social.engagementRate", v));

/** "Refresh" — re-reads every connected account's posts and numbers now. */
export function useRefreshSocial() {
  const ws = useOptionalWorkspaceId();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!ws || busy) return;
    setBusy(true);
    try {
      await syncSocialMetrics(ws);
      await Promise.all([
        qc.invalidateQueries({ queryKey: analyticsKeys.all(ws) }),
        qc.invalidateQueries({ queryKey: ["social-analytics", ws] }),
      ]);
      toast.success("Numbers refreshed");
    } catch (e) {
      toast.error("Couldn't refresh", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

export function RefreshSocialButton() {
  const { run, busy } = useRefreshSocial();
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => void run()}
      disabled={busy}
      className="gap-1.5"
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
      Refresh
    </Button>
  );
}

/** What to show while the social source has nothing to read. */
export function SocialStatusNotice({ status }: { status: SocialReport["status"] }) {
  if (status.state === "syncing")
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/80 bg-card/40 px-6 py-12 text-center"
      >
        <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
        <h3 className="mt-1 text-[13.5px] font-semibold">Reading your posts</h3>
        <p className="max-w-xs text-[12px] text-muted-foreground">
          Mellox is reading your accounts. This takes a minute or two.
        </p>
      </div>
    );
  if (status.state === "unavailable")
    return (
      <EmptyState
        size="sm"
        icon={Heart}
        className="rounded-2xl border border-dashed border-border/80"
        title="Social numbers aren't set up"
        description="Posting to social accounts isn't turned on for this Mellox server yet."
      />
    );
  return (
    <EmptyState
      size="sm"
      icon={Heart}
      className="rounded-2xl border border-dashed border-border/80"
      title="Connect your social accounts"
      description="See views, likes, comments and new followers for every post. No Google needed."
      action={
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => emitAppEvent("open:settings", { section: "accounts" })}
        >
          <Settings className="size-3.5" aria-hidden /> Connect accounts
        </Button>
      }
    />
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="font-medium tabular-nums text-foreground/90">{value}</span> {label}
    </span>
  );
}

export function PostRow({ post }: { post: SocialPostRow }) {
  const m = post.metrics;
  const bits = [
    m.views !== undefined && { label: "views", value: fmt.count(m.views) },
    post.engagement !== null && { label: "interactions", value: fmt.count(post.engagement) },
    m.follows !== undefined && m.follows > 0 && { label: "follows", value: fmt.count(m.follows) },
    m.linkClicks !== undefined &&
      m.linkClicks > 0 && { label: "clicks", value: fmt.count(m.linkClicks) },
  ].filter(Boolean) as Array<{ label: string; value: string }>;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted/50">
        {post.thumbnailUrl ? (
          <img src={post.thumbnailUrl} alt="" className="size-full object-cover" loading="lazy" />
        ) : isPlatformAppIconId(post.platform) ? (
          <PlatformAppIcon platform={post.platform} size={22} />
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium">
          {post.caption.trim() || "Post without a caption"}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
          <PlatformCell platform={post.platform} size={13} />
          {post.postedAt ? (
            <span>
              {new Date(post.postedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          ) : null}
          {bits.length ? (
            bits.map((b) => <Metric key={b.label} {...b} />)
          ) : (
            <span>No numbers yet</span>
          )}
          {!post.madeInMellox ? (
            <span className="rounded-full border border-border/70 px-1.5 py-px text-[10px]">
              Posted outside Mellox
            </span>
          ) : null}
        </div>
      </div>
      {post.url ? (
        <a
          href={post.url}
          target="_blank"
          rel="noreferrer noopener"
          className="shrink-0 rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label={`Open on ${platformName(post.platform)}`}
        >
          <ArrowUpRight className="size-3.5" />
        </a>
      ) : null}
    </li>
  );
}

function GroupBars({
  rows,
  label,
  metric,
}: {
  rows: SocialGroupRow[];
  label: (key: string) => string;
  metric: "avgViews" | "avgEngagement";
}) {
  const max = Math.max(1, ...rows.map((r) => r[metric] ?? 0));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const v = r[metric];
        return (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="truncate">{label(r.key)}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {v === null ? "Too few posts" : `${fmt.count(Math.round(v))} per post`}
                <span className="ml-1.5 text-[10.5px]">({r.posts})</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-muted/60">
              <div
                className="h-full rounded-full bg-primary/80"
                style={{ width: `${v === null ? 0 : Math.max(4, (v / max) * 100)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function SocialPanel() {
  const { data, isLoading, error, refetch } = useAnalyticsReport("social");
  const [trend, setTrend] = useState<(typeof TREND)[number]["id"]>("views");

  if (isLoading && !data) return <ReportSkeleton />;
  if (error && !data) return <ReportError error={error} onRetry={() => void refetch()} />;
  if (!data) return null;
  if (data.status.state !== "ready") return <SocialStatusNotice status={data.status} />;

  const active = TREND.find((t) => t.id === trend)!;
  const kpis = data.kpis.filter((k) => k.value !== null);
  const groupMetric = data.formats.some((f) => f.avgViews !== null) ? "avgViews" : "avgEngagement";
  const groupLabel = groupMetric === "avgViews" ? "Average views" : "Average interactions";
  const synced = data.status.lastSyncedAt
    ? `Updated ${new Date(data.status.lastSyncedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] text-muted-foreground">
          {data.status.accounts} account{data.status.accounts === 1 ? "" : "s"} connected
          {synced ? ` · ${synced}` : ""}
        </p>
        <RefreshSocialButton />
      </div>

      {data.status.reconnect > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-warning-surface px-3 py-2 text-[12px] text-warning">
          <span>
            {data.status.reconnect === 1
              ? "1 account needs"
              : `${data.status.reconnect} accounts need`}{" "}
            to be connected again.
          </span>
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            onClick={() => emitAppEvent("open:settings", { section: "accounts" })}
          >
            Fix it
          </button>
        </div>
      ) : null}

      <KpiGrid kpis={kpis} onAsk={(k) => askMellox(kpiPrompt(k, data.window))} />

      <Card
        title="Over time"
        source="social"
        window={data.window}
        action={
          <Segmented
            label="Chart metric"
            value={trend}
            onChange={setTrend}
            options={TREND.map((t) => ({ value: t.id, label: t.label }))}
          />
        }
      >
        {data.series[trend].some((p) => p.value !== null) ? (
          <TrendChart metric={active.metric} points={data.series[trend]} />
        ) : (
          <p className="py-14 text-center text-[12px] text-muted-foreground">
            Your networks don&apos;t report this number.
          </p>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card title="Best posts" source="social">
          {data.topPosts.length ? (
            <ul className="divide-y divide-border">
              {data.topPosts.map((p) => (
                <PostRow key={p.id} post={p} />
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-[12px] text-muted-foreground">
              No numbers for this period yet. Networks can take up to two days to report them.
            </p>
          )}
        </Card>

        <Card title="By network" source="social">
          {data.byPlatform.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[320px] text-[12px]">
                <thead>
                  <tr className="text-left text-[10.5px] text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">Network</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Posts</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Views</th>
                    <th className="py-1.5 text-right font-medium">Interaction rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.byPlatform.map((p) => (
                    <tr key={p.platform}>
                      <td className="py-2 pr-3">
                        <PlatformCell platform={p.platform} />
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{p.posts}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {p.views === null ? "Not reported" : fmt.count(p.views)}
                      </td>
                      <td className="py-2 text-right tabular-nums">{pct(p.engagementRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-8 text-center text-[12px] text-muted-foreground">
              Nothing went out in this period.
            </p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={`What works · ${groupLabel.toLowerCase()}`} source="social">
          {data.formats.length ? (
            <GroupBars
              rows={data.formats}
              metric={groupMetric}
              label={(k) => FORMAT_LABEL[k] ?? k}
            />
          ) : (
            <p className="text-[12px] text-muted-foreground">No posts in this period.</p>
          )}
        </Card>
        <Card title="Best days to post" source="social">
          {data.weekdays ? (
            <GroupBars
              rows={data.weekdays}
              metric={groupMetric}
              label={(k) => WEEKDAYS[Number(k)] ?? k}
            />
          ) : (
            <p className="text-[12px] text-muted-foreground">
              Shown once there are at least 8 posts in the period.
            </p>
          )}
        </Card>
        <Card title="Made in Mellox vs elsewhere" source="social">
          {data.origin ? (
            <GroupBars
              rows={[data.origin.mellox, data.origin.other]}
              metric={groupMetric}
              label={(k) => (k === "mellox" ? "Made in Mellox" : "Posted elsewhere")}
            />
          ) : (
            <p className="text-[12px] text-muted-foreground">
              Shown once there are at least 2 posts of each.
            </p>
          )}
        </Card>
      </div>

      {data.recentPosts.length > 0 && (
        <Card title="Latest posts" source="social">
          <ul className="divide-y divide-border">
            {data.recentPosts.map((p) => (
              <PostRow key={p.id} post={p} />
            ))}
          </ul>
        </Card>
      )}

      <p className={cn("px-1 text-[10.5px] text-muted-foreground")}>
        A post&apos;s numbers count on the day it went out. Each network reports different numbers;
        one it doesn&apos;t report is left blank, never guessed.
      </p>
    </div>
  );
}
