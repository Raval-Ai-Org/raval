"use client";

// DeliveryView.tsx — the per-destination delivery view for a content item.
// Renders each destination's state (published / publishing / pending / failed)
// with the live link, the platform's failure reason, engagement once the
// platform reports it, and a Retry for failed SocialAPI.ai deliveries. Data
// comes from the webhook- and reconcile-fed content_publications mirror; the
// view re-fetches on content:changed and polls gently while anything is in
// flight. Empty state = the item was never distributed.
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RotateCw } from "lucide-react";
import { ExternalLink, Loader2 } from "@/components/icons";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/button";
import { getPublications, retryPublication, type PublicationRow } from "@/lib/sdr.functions";
import { DISTRIBUTION_PLATFORMS, isDistributionPlatform } from "@/lib/distribution-platforms";
import { cn } from "@/lib/utils";

/** Status → chip styling. Mirrors the content_publications status set. */
const STATUS_STYLE: Record<string, string> = {
  published: "bg-success-surface text-success ring-success-border",
  retrying: "bg-warning-surface text-warning ring-warning-border",
  failed: "bg-danger-surface text-danger ring-danger-border",
  partial_failed: "bg-warning-surface text-warning ring-warning-border",
  publishing: "bg-info-surface text-info ring-info-border",
  pending: "bg-surface-2 text-muted-foreground ring-border",
  cancelled: "bg-surface-2 text-muted-foreground ring-border",
};

const IN_FLIGHT = new Set(["publishing", "retrying"]);
const POLL_MS = 15_000;

const labelFor = (platform: string) =>
  isDistributionPlatform(platform) ? DISTRIBUTION_PLATFORMS[platform].label : platform;

function PlatformMark({ platform }: { platform: string }) {
  const meta = isDistributionPlatform(platform) ? DISTRIBUTION_PLATFORMS[platform] : null;
  if (!meta) return <span className="h-4 w-4 shrink-0 rounded-md bg-muted" aria-hidden />;
  return (
    <span className="grid shrink-0 place-items-center" style={{ color: meta.tint }} aria-hidden>
      <BrandLogo name={meta.logo} brand size={16} />
    </span>
  );
}

function statusText(status: string): string {
  switch (status) {
    case "published":
      return "Published";
    case "retrying":
      return "Retrying…";
    case "failed":
      return "Failed";
    case "partial_failed":
      return "Partially failed";
    case "publishing":
      return "Publishing…";
    case "pending":
      return "Scheduled";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function engagementLine(m: PublicationRow["metrics"]): string | null {
  if (!m) return null;
  const parts = [
    [m.views, "views"],
    [m.likes, "likes"],
    [m.comments, "comments"],
    [m.shares, "shares"],
  ]
    .filter(([n]) => typeof n === "number" && (n as number) > 0)
    .map(([n, label]) => `${(n as number).toLocaleString()} ${label}`);
  return parts.length ? parts.join(" · ") : null;
}

export function DeliveryView({
  workspaceId,
  contentItemId,
}: {
  workspaceId: string;
  contentItemId: string;
}) {
  const [rows, setRows] = useState<PublicationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // The last seen terminal state per row, so each outcome toasts once — and
  // rows already terminal on first load don't toast at all.
  const notified = useRef<Record<string, string> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getPublications(workspaceId, contentItemId);
      setRows(data);
      setError(null);
      const first = notified.current === null;
      const seen = (notified.current ??= {});
      for (const row of data) {
        if (row.status !== "published" && row.status !== "failed") continue;
        if (seen[row.id] === row.status) continue;
        seen[row.id] = row.status;
        if (first) continue;
        const label = labelFor(row.platform);
        if (row.status === "published") {
          toast.success(`Posted to ${label}`, { description: row.platform_post_url ?? undefined });
        } else {
          toast.error(`Couldn't post to ${label}`, {
            description: row.last_error ?? "The platform rejected the post.",
          });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load delivery status");
    }
  }, [workspaceId, contentItemId]);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    addAppEventListener("content:changed", onChange);
    return () => removeAppEventListener("content:changed", onChange);
  }, [load]);

  const inFlight = Boolean(rows?.some((r) => IN_FLIGHT.has(r.status)));
  useEffect(() => {
    if (!inFlight) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [inFlight, load]);

  const retry = async () => {
    setRetrying(true);
    try {
      await retryPublication(workspaceId, contentItemId);
      toast.success("Retrying the failed destinations");
      emitAppEvent("content:changed");
      await load();
    } catch (e) {
      toast.error("Couldn't retry", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setRetrying(false);
    }
  };

  if (rows === null) {
    if (error) {
      return (
        <div className="flex items-center justify-between gap-2 px-1 text-[12px]">
          <span className="text-destructive">{error}</span>
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            onClick={() => void load()}
          >
            Try again
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 px-1 text-[12px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading delivery status…
      </div>
    );
  }

  if (rows.length === 0) return null;

  const canRetry = rows.some((r) => r.status === "failed" && r.provider === "socialapi");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Delivery
        </h4>
        {canRetry ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-[11.5px]"
            loading={retrying}
            onClick={() => void retry()}
          >
            {!retrying ? <RotateCw className="h-3 w-3" aria-hidden /> : null}
            Retry failed
          </Button>
        ) : null}
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const engagement = row.status === "published" ? engagementLine(row.metrics) : null;
          return (
            <li
              key={row.id}
              className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3 py-2"
            >
              <PlatformMark platform={row.platform} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[12.5px] font-medium text-foreground">
                    {labelFor(row.platform)}
                  </span>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide ring-1",
                      STATUS_STYLE[row.status] ?? "bg-secondary text-muted-foreground ring-border",
                    )}
                  >
                    {statusText(row.status)}
                  </span>
                </div>
                {row.platform_post_url && (
                  <a
                    href={row.platform_post_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex max-w-full items-center gap-1 truncate text-[11.5px] text-[hsl(var(--brand-blue))] hover:underline"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    <span className="truncate">{row.platform_post_url}</span>
                  </a>
                )}
                {engagement ? (
                  <p className="text-[11px] text-muted-foreground">{engagement}</p>
                ) : null}
                {row.status === "failed" && row.last_error && (
                  <p
                    className="line-clamp-2 text-[11px] text-muted-foreground"
                    title={row.last_error}
                  >
                    {row.last_error}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
