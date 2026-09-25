"use client";
// CompetitorCard.tsx — one competitor at a glance: who they are, what they
// sell, and when something last changed. The whole card opens the details.
//
// A card only ever shows what was really found. A competitor that has not
// been researched yet says so; one whose site could not be read says why.
// Nothing is filled in with a plausible guess.
import * as React from "react";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/components/app/geo/geo-ui";
import { ArrowRight, RefreshCw, Spinner } from "@/components/icons";
import { RelationshipChip, SiteMark, SourceChips } from "./competitors-ui";
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
    <article className="group relative flex min-h-[220px] flex-col rounded-[22px] border border-border/50 bg-surface-3 p-5 shadow-sm transition-all duration-200 motion-safe:hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md dark:border-white/[0.06] dark:bg-white/[0.035]">
      <div className="flex min-w-0 items-start gap-3">
        <SiteMark domain={competitor.domain} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 truncate text-[15.5px] font-semibold tracking-tight text-foreground">
              {/* The title is the card's main button; its hit area covers the card. */}
              <button
                type="button"
                onClick={onOpen}
                className="text-left after:absolute after:inset-0 after:rounded-[22px] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary/40"
              >
                {competitor.name}
              </button>
            </h3>
            {competitor.unreadUpdates > 0 && (
              <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                {competitor.unreadUpdates} new
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
            {competitor.domain}
          </div>
        </div>
        <div className="shrink-0">
          <RelationshipChip relationship={competitor.relationship} />
        </div>
      </div>

      <div className="mt-4 flex-1">
        {profile?.summary ? (
          <p className="line-clamp-2 text-[13.5px] leading-relaxed text-foreground/85">
            {profile.summary}
          </p>
        ) : researching ? (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Spinner className="h-3.5 w-3.5 animate-spin" />
            Reading their website…
          </p>
        ) : competitor.profileStatus === "failed" ? (
          <p className="line-clamp-2 text-[13px] text-muted-foreground">
            {competitor.profileError ?? "We couldn't read this website."}
          </p>
        ) : (
          <p className="text-[13px] text-muted-foreground">Not looked at yet.</p>
        )}

        {profile?.products?.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {profile.products.slice(0, 3).map((product) => (
              <span
                key={product}
                className="max-w-[160px] truncate rounded-full bg-foreground/[0.06] px-2.5 py-1 text-[11.5px] font-medium text-foreground/75"
              >
                {product}
              </span>
            ))}
            {profile.products.length > 3 && (
              <span className="px-1 py-1 text-[11.5px] text-muted-foreground">
                +{profile.products.length - 3}
              </span>
            )}
          </div>
        ) : null}
        {profile?.companyFacts?.length ? (
          <p className="mt-3 line-clamp-2 rounded-xl bg-primary/[0.06] px-3 py-2 text-[12px] leading-relaxed text-foreground/80">
            <span className="font-semibold text-primary">Company fact · </span>
            {profile.companyFacts[0]}
          </p>
        ) : null}
        {competitor.discoverySources.length > 0 && (
          <div className="relative z-10 mt-3">
            <SourceChips sources={competitor.discoverySources} limit={2} />
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/50 pt-3">
        <span className="truncate text-[12px] text-muted-foreground">
          {competitor.lastUpdateAt
            ? `Changed ${relativeTime(competitor.lastUpdateAt)}`
            : competitor.updatesCheckedAt
              ? `Checked ${relativeTime(competitor.updatesCheckedAt)}`
              : "Not checked yet"}
        </span>
        {/* Above the card's hit area, so it stays its own button. */}
        <div className="relative z-10 flex items-center gap-1">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing || researching}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground disabled:opacity-40"
            aria-label={`Look again at ${competitor.name}`}
            title="Look again"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          </button>
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
          >
            <ArrowRight className="h-4 w-4" />
          </span>
        </div>
      </div>
    </article>
  );
}
