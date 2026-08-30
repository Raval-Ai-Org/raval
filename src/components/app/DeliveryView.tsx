// DeliveryView.tsx — the per-platform delivery view for a content item (US4,
// FR-010/FR-011). Renders each destination's delivery state (published /
// retrying / failed / pending) with the live link when available and the
// failure reason when a delivery failed. Data comes from getPublications (the
// webhook-fed content_publications mirror); the panel re-fetches on
// content:changed so webhook-driven updates appear without a manual refresh
// (R2d). Empty state = the item has no SDR delivery rows (not distributed).
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Twitter,
  Linkedin,
  Facebook,
  Instagram,
  type LucideIcon,
} from "@/components/ui/gemini-icons";
import { getPublications, type PublicationRow } from "@/lib/sdr.functions";
import { cn } from "@/lib/utils";

/** SDR wire-id → display label + icon (matches ConnectionsPanel). */
const PLATFORM_META: Record<string, { label: string; icon: LucideIcon; tint: string }> = {
  twitter: { label: "X", icon: Twitter, tint: "#0F1419" },
  linkedin: { label: "LinkedIn", icon: Linkedin, tint: "#0A66C2" },
  facebook: { label: "Facebook", icon: Facebook, tint: "#1877F2" },
  instagram: { label: "Instagram", icon: Instagram, tint: "#E1306C" },
};

/** Status → chip styling. Mirrors the content_publications status set. */
const STATUS_STYLE: Record<string, string> = {
  published: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400",
  retrying: "bg-amber-500/10 text-amber-600 ring-amber-500/25 dark:text-amber-400",
  failed: "bg-rose-500/10 text-rose-600 ring-rose-500/25 dark:text-rose-400",
  partial_failed: "bg-amber-500/10 text-amber-600 ring-amber-500/25 dark:text-amber-400",
  publishing: "bg-sky-500/10 text-sky-600 ring-sky-500/25 dark:text-sky-400",
  pending: "bg-secondary text-muted-foreground ring-border",
  cancelled: "bg-secondary text-muted-foreground ring-border",
};

function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const meta = PLATFORM_META[platform];
  const Icon = meta?.icon;
  if (!Icon) {
    return <span className={cn("h-5 w-5 shrink-0 rounded-md bg-muted", className)} aria-hidden />;
  }
  return (
    <Icon className={cn("h-4 w-4 shrink-0", className)} aria-hidden style={{ color: meta.tint }} />
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
      return "Pending";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
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
  // Track the last seen terminal state per row id so the success/failure toast
  // fires once per delivery, not on every content:changed re-fetch.
  const notified = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const data = await getPublications(workspaceId, contentItemId);
      setRows(data);
      setError(null);
      // US4 terminal-state toasts (green tick / red failure) — human-readable,
      // shown once per delivery transition (FR-010 / SC-002).
      for (const row of data) {
        if (
          row.status !== "published" &&
          row.status !== "failed" &&
          row.status !== "partial_failed"
        )
          continue;
        if (notified.current[row.id] === row.status) continue;
        notified.current[row.id] = row.status;
        const label = PLATFORM_META[row.platform]?.label ?? row.platform;
        if (row.status === "published") {
          toast.success(`Successfully posted to ${label}`, {
            description: row.platform_post_url ?? undefined,
          });
        } else if (row.status === "partial_failed") {
          toast.warning(`Partly posted to ${label}`, {
            description: row.last_error ?? "Some destinations didn't go through.",
          });
        } else {
          toast.error(`Failed to post to ${label}`, {
            description: row.last_error ?? "The destination rejected the post.",
          });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load delivery status");
    }
  }, [workspaceId, contentItemId]);

  useEffect(() => {
    void load();
    // R2d: re-fetch on content:changed so webhook-driven status updates appear
    // without a manual refresh (US4 / SC-002).
    const onChange = () => void load();
    window.addEventListener("content:changed", onChange);
    return () => window.removeEventListener("content:changed", onChange);
  }, [load]);

  if (rows === null) {
    if (error) {
      return <p className="px-1 text-[12px] text-destructive">{error}</p>;
    }
    return (
      <div className="flex items-center gap-2 px-1 text-[12px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading delivery status…
      </div>
    );
  }

  if (rows.length === 0) {
    return null; // no SDR delivery rows — nothing to show
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Delivery
        </h4>
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const meta = PLATFORM_META[row.platform];
          return (
            <li
              key={row.id}
              className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3 py-2"
            >
              <PlatformIcon platform={row.platform} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[12.5px] font-medium text-foreground">
                    {meta?.label ?? row.platform}
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
                {(row.status === "failed" || row.status === "partial_failed") && row.last_error && (
                  <p className="truncate text-[11px] text-muted-foreground" title={row.last_error}>
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
