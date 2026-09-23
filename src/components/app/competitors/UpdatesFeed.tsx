"use client";
// UpdatesFeed.tsx — "what changed recently", across every competitor.
//
// Grouped by day, biggest first within a day. Every row carries the source it
// came from, because the point of this feed is that the user can check it —
// a change Mellox cannot point at is not worth showing.
import * as React from "react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Bell,
  ExternalLink,
  FileText,
  Globe,
  Megaphone,
  Rocket,
  Sparkles,
  Target,
  Wallet,
} from "@/components/icons";
import { ghostBtn, relativeTime } from "@/components/app/geo/geo-ui";
import { SiteMark, hostOf } from "./competitors-ui";
import {
  UPDATE_KIND_LABELS,
  type CompetitorUpdateKind,
  type CompetitorUpdateView,
} from "@/lib/competitors.functions";

const KIND: Record<
  CompetitorUpdateKind,
  { icon: React.ComponentType<{ className?: string }>; tint: string }
> = {
  launch: { icon: Rocket, tint: "bg-primary/15 text-primary" },
  pricing: { icon: Wallet, tint: "bg-warning/15 text-warning" },
  positioning: { icon: Target, tint: "bg-info/15 text-info" },
  funding: { icon: Sparkles, tint: "bg-success/15 text-success" },
  campaign: { icon: Megaphone, tint: "bg-destructive/12 text-destructive" },
  content: { icon: FileText, tint: "bg-foreground/[0.07] text-foreground/75" },
  site_change: { icon: Globe, tint: "bg-foreground/[0.07] text-foreground/75" },
};

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

export function UpdateRow({
  update,
  showCompetitor = true,
}: {
  update: CompetitorUpdateView;
  showCompetitor?: boolean;
}) {
  const kind = KIND[update.kind];
  const Icon = kind.icon;
  const unread = !update.readAt;
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)] gap-3.5 rounded-[20px] p-3.5 transition-colors sm:p-4",
        unread ? "bg-primary/[0.06]" : "hover:bg-foreground/[0.03]",
      )}
    >
      <span className={cn("relative grid h-10 w-10 place-items-center rounded-full", kind.tint)}>
        <Icon className="h-[18px] w-[18px]" />
        {unread && (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" />
        )}
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
          {showCompetitor && (
            <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-foreground/80">
              <SiteMark domain={update.competitorDomain} size={16} />
              <span className="truncate">{update.competitorName}</span>
            </span>
          )}
          <span>{UPDATE_KIND_LABELS[update.kind]}</span>
          <span aria-hidden>·</span>
          <span>{relativeTime(update.publishedAt ?? update.detectedAt)}</span>
          {update.significance === "major" && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
              Big change
            </span>
          )}
        </div>
        <p className="mt-1 text-[14px] font-medium leading-snug text-foreground">{update.title}</p>
        {update.summary && (
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
            {update.summary}
          </p>
        )}
        {update.sourceUrl && (
          <a
            href={update.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-primary"
          >
            {hostOf(update.sourceUrl)}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

export function UpdatesFeed({
  updates,
  unread,
  onMarkRead,
  hasCompetitors,
}: {
  updates: CompetitorUpdateView[];
  unread: number;
  onMarkRead: () => void;
  hasCompetitors: boolean;
}) {
  const groups = React.useMemo(() => {
    const map = new Map<string, CompetitorUpdateView[]>();
    for (const update of updates) {
      const key = dayLabel(update.detectedAt);
      const bucket = map.get(key);
      if (bucket) bucket.push(update);
      else map.set(key, [update]);
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) =>
        a.significance === b.significance ? 0 : a.significance === "major" ? -1 : 1,
      );
    }
    return [...map.entries()];
  }, [updates]);

  if (!updates.length) {
    return (
      <EmptyState
        icon={Bell}
        title={hasCompetitors ? "Nothing new" : "No competitors yet"}
        description={
          hasCompetitors
            ? "Launches, price changes and new messaging show up here."
            : "Add a competitor to see what they change."
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      {unread > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] text-muted-foreground">{unread} new</span>
          <button
            type="button"
            onClick={onMarkRead}
            className={cn(ghostBtn, "h-8 px-3 text-[12px]")}
          >
            Mark all read
          </button>
        </div>
      )}
      {groups.map(([label, items]) => (
        <section key={label} data-no-rhythm>
          <h4 className="mb-1 px-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {label}
          </h4>
          <div className="space-y-1">
            {items.map((update) => (
              <UpdateRow key={update.id} update={update} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
