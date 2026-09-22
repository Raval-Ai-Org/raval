"use client";
// CompetitorCard.tsx — one competitor, answering the three questions the
// surface exists for: who are they, what do they do, and what changed.
//
// A card only ever shows what was really found. A competitor that has not
// been researched yet says so; one whose site could not be read says why.
// Nothing is filled in with a plausible guess.
import * as React from "react";
import { cn } from "@/lib/utils";
import { Chip, ghostBtn, relativeTime } from "@/components/app/geo/geo-ui";
import { ArrowRight, ExternalLink, RefreshCw, Spinner } from "@/components/icons";
import { Card, RelationshipChip, SiteMark, SourceChips } from "./competitors-ui";
import type { CompetitorView } from "@/lib/competitors.functions";

export function CompetitorCard({
  competitor,
  onOpen,
  onRefresh,
  refreshing,
}: {
  competitor: CompetitorView;
  onOpen: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const profile = competitor.profile;
  const researching =
    competitor.profileStatus === "running" || competitor.profileStatus === "pending";

  return (
    <Card className="flex flex-col gap-3 transition-colors hover:border-foreground/15">
      <div className="flex min-w-0 items-start gap-3">
        <SiteMark domain={competitor.domain} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="truncate text-[14.5px] font-semibold tracking-tight text-foreground">
              {competitor.name}
            </h3>
            <RelationshipChip relationship={competitor.relationship} />
            {competitor.unreadUpdates > 0 && (
              <Chip tone="primary">{competitor.unreadUpdates} new</Chip>
            )}
          </div>
          <a
            href={competitor.url ?? `https://${competitor.domain}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {competitor.domain}
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      </div>

      {profile?.summary ? (
        <p className="line-clamp-3 text-[13px] leading-relaxed text-foreground/85">
          {profile.summary}
        </p>
      ) : researching ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Spinner className="h-3.5 w-3.5 animate-spin" />
          Reading their website…
        </p>
      ) : competitor.profileStatus === "failed" ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {competitor.profileError ?? "We couldn't read this website."}
        </p>
      ) : (
        <p className="text-[13px] text-muted-foreground">Not looked at yet.</p>
      )}

      {profile?.products?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {profile.products.slice(0, 4).map((product) => (
            <span
              key={product}
              className="max-w-[200px] truncate rounded-full bg-muted px-2 py-0.5 text-[11.5px] text-muted-foreground"
            >
              {product}
            </span>
          ))}
        </div>
      ) : null}

      {profile?.sources?.length ? <SourceChips sources={profile.sources} limit={3} /> : null}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="text-[11.5px] text-muted-foreground">
          {competitor.lastUpdateAt
            ? `Last change ${relativeTime(competitor.lastUpdateAt)}`
            : competitor.updatesCheckedAt
              ? `Checked ${relativeTime(competitor.updatesCheckedAt)}`
              : "Not checked yet"}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing || researching}
            className={cn(ghostBtn, "h-7 px-2.5 text-[12px]")}
            aria-label={`Look again at ${competitor.name}`}
          >
            <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
            Look again
          </button>
          <button type="button" onClick={onOpen} className={cn(ghostBtn, "h-7 px-2.5 text-[12px]")}>
            Details
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </Card>
  );
}
