"use client";

// SocialPerformance — measured social results for the Analytics › Social tab:
// delivery outcomes, engagement pulled from the platforms (via SocialAPI.ai),
// top posts, recent failures, account health and publishing credits. Nothing
// is estimated; with no deliveries the panel says so.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Loader2, RotateCw } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/button";
import { emitAppEvent } from "@/lib/app-events";
import { DISTRIBUTION_PLATFORMS, isDistributionPlatform } from "@/lib/distribution-platforms";
import { getSocialAnalytics, syncSocialMetrics, type SocialAnalytics } from "@/lib/sdr.functions";

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

function PlatformName({ platform }: { platform: string }) {
  const meta = isDistributionPlatform(platform) ? DISTRIBUTION_PLATFORMS[platform] : null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {meta ? (
        <span style={{ color: meta.tint }} className="grid shrink-0 place-items-center">
          <BrandLogo name={meta.logo} brand size={13} />
        </span>
      ) : null}
      <span className="truncate">{meta?.label ?? platform}</span>
    </span>
  );
}

function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card/60 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SocialPerformance({
  workspaceId,
  days,
}: {
  workspaceId: string | null;
  days: number;
}) {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const query = useQuery({
    queryKey: ["social-analytics", workspaceId, days],
    queryFn: () => getSocialAnalytics(workspaceId as string, days),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });

  const sync = async () => {
    if (!workspaceId) return;
    setSyncing(true);
    try {
      const out = await syncSocialMetrics(workspaceId);
      toast.success(
        out.posts
          ? `Refreshed metrics for ${out.posts} post${out.posts === 1 ? "" : "s"}`
          : "No recent posts to refresh",
      );
      await queryClient.invalidateQueries({ queryKey: ["social-analytics", workspaceId] });
    } catch (e) {
      toast.error("Couldn't refresh metrics", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSyncing(false);
    }
  };

  if (!workspaceId) return null;

  if (query.isLoading) {
    return (
      <Card title="Social performance" subtitle="Loading measured results…">
        <div
          className="grid grid-cols-2 gap-3 md:grid-cols-4"
          aria-label="Loading social performance"
        >
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[74px] animate-pulse rounded-2xl bg-secondary/60" />
          ))}
        </div>
      </Card>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card title="Social performance">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-3">
          <p className="text-[12px] text-destructive">
            {query.error instanceof Error
              ? query.error.message
              : "Couldn't load social performance."}
          </p>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      </Card>
    );
  }

  const data: SocialAnalytics = query.data;
  const { totals } = data;

  if (!data.provider && totals.deliveries === 0) {
    return (
      <Card
        title="Social performance"
        subtitle="Delivery and engagement from your connected accounts"
      >
        <p className="rounded-xl border border-dashed border-border p-5 text-center text-[12px] text-muted-foreground">
          Direct publishing isn&apos;t enabled for this workspace, so there are no delivery results
          to report.
        </p>
      </Card>
    );
  }

  const kpis = [
    { label: `Published (${data.rangeDays}d)`, value: totals.published },
    { label: "Failed deliveries", value: totals.failed },
    { label: "Likes", value: totals.likes },
    { label: "Comments", value: totals.comments },
    { label: "Shares", value: totals.shares },
    ...(totals.views > 0 ? [{ label: "Views", value: totals.views }] : []),
  ];

  return (
    <Card
      title="Social performance"
      subtitle={
        data.metricsSyncedAt
          ? `Engagement last refreshed ${new Date(data.metricsSyncedAt).toLocaleString()}`
          : "Engagement is read from the platforms after posts go live"
      }
      action={
        data.provider === "socialapi" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void sync()}
            disabled={syncing}
            className="gap-1.5"
          >
            {syncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCw className="h-3.5 w-3.5" />
            )}
            Refresh metrics
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-5">
        {data.accounts.reconnect > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-warning-surface px-3 py-2 text-[12px] text-warning">
            <span>
              {data.accounts.reconnect === 1
                ? "1 account needs"
                : `${data.accounts.reconnect} accounts need`}{" "}
              to be reconnected before it can publish.
            </span>
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              onClick={() => emitAppEvent("open:settings")}
            >
              Manage accounts
            </button>
          </div>
        ) : null}

        {totals.deliveries === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-5 text-center text-[12px] text-muted-foreground">
            No posts were sent to social accounts in the last {data.rangeDays} days. Publish or
            schedule from Studio and results appear here.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {kpis.map((k) => (
                <div key={k.label} className="rounded-2xl border border-border bg-card/70 p-3.5">
                  <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
                    {k.label}
                  </div>
                  <div className="mt-1.5 text-lg font-semibold tabular-nums">
                    {compact.format(k.value)}
                  </div>
                </div>
              ))}
            </div>

            {data.byPlatform.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-[12px]">
                  <thead>
                    <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
                      <th className="py-1.5 pr-3 font-medium">Platform</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Published</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Failed</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Likes</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Comments</th>
                      <th className="py-1.5 text-right font-medium">Shares</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.byPlatform.map((p) => (
                      <tr key={p.platform}>
                        <td className="py-2 pr-3">
                          <PlatformName platform={p.platform} />
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{p.published}</td>
                        <td
                          className={`py-2 pr-3 text-right tabular-nums ${p.failed ? "text-danger" : ""}`}
                        >
                          {p.failed}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {compact.format(p.likes)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {compact.format(p.comments)}
                        </td>
                        <td className="py-2 text-right tabular-nums">{compact.format(p.shares)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Top posts
                </h3>
                {data.topPosts.length ? (
                  <ul className="divide-y divide-border">
                    {data.topPosts.map((p) => (
                      <li
                        key={`${p.contentItemId}-${p.platform}`}
                        className="flex items-center gap-3 py-2 text-[12px]"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{p.title}</p>
                          <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <PlatformName platform={p.platform} />
                            <span className="tabular-nums">
                              {compact.format(p.likes)} likes · {compact.format(p.comments)}{" "}
                              comments
                            </span>
                          </p>
                        </div>
                        {p.url ? (
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground"
                            aria-label={`Open post on ${p.platform}`}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-muted-foreground">
                    No engagement recorded yet. Metrics appear once the platforms report them.
                  </p>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Recent failures
                </h3>
                {data.failures.length ? (
                  <ul className="divide-y divide-border">
                    {data.failures.map((f) => (
                      <li
                        key={`${f.contentItemId}-${f.platform}-${f.at}`}
                        className="py-2 text-[12px]"
                      >
                        <p className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium">{f.title}</span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            <PlatformName platform={f.platform} />
                          </span>
                        </p>
                        {f.error ? (
                          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                            {f.error}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-muted-foreground">
                    No failed deliveries in this period.
                  </p>
                )}
              </div>
            </div>
          </>
        )}

        {data.credits ? (
          <p className="text-[11px] text-muted-foreground">
            Publishing credits this month: {data.credits.used} of {data.credits.limit} used.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
