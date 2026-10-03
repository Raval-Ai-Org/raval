"use client";

// Stories — how this workspace's Instagram and Facebook Stories did. Networks
// only report Story numbers while a Story is live, so Mellox reads them every
// hour for the first day and keeps the last reading. Nothing is estimated: a
// Story with no numbers says so.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Story } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { DISTRIBUTION_PLATFORMS, isDistributionPlatform } from "@/lib/distribution-platforms";
import { getStoryAnalytics } from "@/lib/stories.functions";
import { formatHour, summarizeStories, type StoryRecord } from "@/lib/stories/metrics";
import { openComposer } from "@/lib/studio/session-store";
import { useServerFn } from "@/lib/use-server-fn";
import { Card } from "./ui";

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

function when(iso: string | null): string {
  if (!iso) return "Not posted yet";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function StoriesPerformance({ workspaceId, days }: { workspaceId: string; days: number }) {
  const fetcher = useServerFn(getStoryAnalytics);
  const { data, isLoading } = useQuery({
    queryKey: ["story-analytics", workspaceId, days],
    queryFn: () => fetcher({ data: { workspaceId, days: Math.min(90, Math.max(1, days)) } }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const stories = data?.stories ?? [];
  const summary = useMemo(() => {
    const records: StoryRecord[] = stories
      .filter((s) => s.status === "published")
      .map((s) => ({
        id: s.id,
        title: s.title,
        platform: s.platform,
        publishedAt: s.publishedAt,
        // The viewer's own clock: "best time" should mean their time.
        hour: s.publishedAt ? new Date(s.publishedAt).getHours() : null,
        frames: s.frames,
        metrics: s.metrics,
        hold: s.hold,
      }));
    return summarizeStories(records);
  }, [stories]);

  if (isLoading) {
    return (
      <Card title="Stories" source="mellox">
        <div className="h-24 animate-pulse rounded-xl bg-[var(--ds-well-bg)]" />
      </Card>
    );
  }

  if (!stories.length) {
    return (
      <Card title="Stories" source="mellox">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted-foreground">
            No Stories in this period. Their numbers show here once one goes out.
          </p>
          <Button variant="outline" size="sm" onClick={() => openComposer({ type: "story" })}>
            <Story />
            Make a Story
          </Button>
        </div>
      </Card>
    );
  }

  const stats: { label: string; value: string; hint?: string }[] = [
    { label: "Stories posted", value: String(summary.count) },
    {
      label: "People reached",
      value: summary.measured ? compact.format(summary.reach) : "–",
      hint: summary.measured ? `${compact.format(summary.avgReach)} per Story` : "No numbers yet",
    },
    {
      label: "Replies",
      value: summary.measured ? compact.format(summary.replies) : "–",
      hint:
        summary.replyRate !== null && summary.replies > 0
          ? `${(summary.replyRate * 100).toFixed(1)}% of viewers`
          : undefined,
    },
    {
      label: "Best time",
      value: summary.bestHour !== null ? formatHour(summary.bestHour) : "–",
      hint: summary.bestHour !== null ? "Your time" : "Needs a few more Stories",
    },
  ];

  return (
    <Card title="Stories" source="mellox">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card/70 p-4">
            <div className="text-[11px] text-muted-foreground">{s.label}</div>
            <div className="mt-1.5 text-2xl font-semibold tabular-nums">{s.value}</div>
            {s.hint ? (
              <div className="mt-0.5 text-[11px] text-muted-foreground">{s.hint}</div>
            ) : null}
          </div>
        ))}
      </div>

      <ul className="mt-4 divide-y divide-border/60">
        {stories.slice(0, 12).map((s, i) => {
          const meta =
            s.platform && isDistributionPlatform(s.platform)
              ? DISTRIBUTION_PLATFORMS[s.platform]
              : null;
          return (
            <li key={`${s.id}-${s.platform}-${i}`} className="flex items-center gap-3 py-2.5">
              {meta ? (
                <span style={{ color: meta.tint }} className="grid shrink-0 place-items-center">
                  <BrandLogo name={meta.logo} brand size={15} />
                </span>
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{s.title}</p>
                <p className="text-[11.5px] text-muted-foreground">
                  {s.status === "failed"
                    ? (s.error ?? "Didn't go out")
                    : s.status === "published"
                      ? when(s.publishedAt)
                      : "Scheduled"}
                  {s.frames > 1 ? ` · ${s.frames} frames` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right text-[12px] tabular-nums">
                {s.metrics && (s.metrics.reach || s.metrics.views) ? (
                  <>
                    <p className="font-semibold">
                      {compact.format(s.metrics.reach || s.metrics.views)}{" "}
                      <span className="font-normal text-muted-foreground">
                        {s.metrics.reach ? "reached" : "views"}
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {s.metrics.replies ? `${s.metrics.replies} replies` : ""}
                      {s.metrics.replies && s.hold !== null ? " · " : ""}
                      {s.hold !== null ? `${Math.round(s.hold * 100)}% saw the last frame` : ""}
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    {s.status === "published" ? "No numbers from the network" : ""}
                  </p>
                )}
              </div>
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="Open the Story"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Instagram and Facebook share Story numbers for 24 hours. Mellox saves them before they go.
      </p>
    </Card>
  );
}
