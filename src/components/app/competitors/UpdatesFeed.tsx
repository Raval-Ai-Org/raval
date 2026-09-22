"use client";
// UpdatesFeed.tsx — "what changed recently", across every competitor.
//
// Grouped by day, biggest first within a day. Every row carries the source it
// came from, because the point of this feed is that the user can check it —
// a change Mellox cannot point at is not worth showing.
import * as React from "react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { ExternalLink } from "@/components/icons";
import { ghostBtn, relativeTime } from "@/components/app/geo/geo-ui";
import { Card, SiteMark, UpdateKindBadge, hostOf } from "./competitors-ui";
import type { CompetitorUpdateView } from "@/lib/competitors.functions";

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
  return (
    <Card
      className={cn(
        "flex min-w-0 gap-3 p-3",
        !update.readAt && "border-primary/25 bg-primary/[0.03]",
      )}
    >
      {showCompetitor && <SiteMark domain={update.competitorDomain} size={28} />}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <UpdateKindBadge kind={update.kind} significance={update.significance} />
          {showCompetitor && update.competitorName && (
            <span className="truncate text-[12px] font-medium text-foreground/80">
              {update.competitorName}
            </span>
          )}
          <span className="text-[11.5px] text-muted-foreground">
            {relativeTime(update.publishedAt ?? update.detectedAt)}
          </span>
        </div>
        <p className="mt-1 text-[13.5px] font-medium leading-snug text-foreground">
          {update.title}
        </p>
        {update.summary && (
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
            {update.summary}
          </p>
        )}
        {update.sourceUrl && (
          <a
            href={update.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {hostOf(update.sourceUrl)}
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </Card>
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
        title={hasCompetitors ? "Nothing new" : "No competitors yet"}
        description={
          hasCompetitors
            ? "We check your competitors regularly. You'll see real changes here — launches, price changes, new positioning — not every blog post."
            : "Add a competitor and we'll tell you when something real changes."
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {unread > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12.5px] text-muted-foreground">
            {unread} new change{unread === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={onMarkRead}
            className={cn(ghostBtn, "h-7 px-2.5 text-[12px]")}
          >
            Mark all read
          </button>
        </div>
      )}
      {groups.map(([label, items]) => (
        <div key={label}>
          <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </h3>
          <div className="space-y-2">
            {items.map((update) => (
              <UpdateRow key={update.id} update={update} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
