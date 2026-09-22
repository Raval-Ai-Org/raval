"use client";
// CompetitorDetail.tsx — everything Mellox found about one competitor, with
// the evidence attached.
//
// The order is the order a person asks: who are they, what do they sell, who
// to, how do they position it, what is strong and weak — then what changed,
// then the raw evidence. Interpretation is visually separated from measured
// evidence, which is the same discipline the prompts are held to.
import * as React from "react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { Chip, ghostBtn, primaryBtn, relativeTime } from "@/components/app/geo/geo-ui";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ExternalLink,
  RefreshCw,
  Spinner,
  Trash,
} from "@/components/icons";
import { Card, Field, FieldList, RelationshipChip, SiteMark, SourceChips } from "./competitors-ui";
import { UpdateRow } from "./UpdatesFeed";
import type { CompetitorUpdateView, CompetitorView } from "@/lib/competitors.functions";

export function CompetitorDetail({
  competitor,
  updates,
  onBack,
  onRefresh,
  onRemove,
  refreshing,
}: {
  competitor: CompetitorView;
  updates: CompetitorUpdateView[];
  onBack: () => void;
  onRefresh: (full: boolean) => void;
  onRemove: () => void;
  refreshing: boolean;
}) {
  const profile = competitor.profile;
  const researching =
    competitor.profileStatus === "running" || competitor.profileStatus === "pending";

  return (
    <section aria-label={`${competitor.name} details`} className="space-y-4">
      <button type="button" onClick={onBack} className={cn(ghostBtn, "h-8 px-3 text-[12.5px]")}>
        <ArrowLeft className="h-3.5 w-3.5" />
        All competitors
      </button>

      <Card className="space-y-4">
        <div className="flex min-w-0 flex-wrap items-start gap-3">
          <SiteMark domain={competitor.domain} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-[17px] font-semibold tracking-tight text-foreground">
                {competitor.name}
              </h2>
              <RelationshipChip relationship={competitor.relationship} />
            </div>
            <a
              href={competitor.url ?? `https://${competitor.domain}`}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {competitor.domain}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onRefresh(true)}
              disabled={refreshing || researching}
              className={cn(primaryBtn, "h-8 px-3 text-[12.5px]")}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              Research again
            </button>
            <button
              type="button"
              onClick={onRemove}
              className={cn(ghostBtn, "h-8 px-3 text-[12.5px]")}
            >
              <Trash className="h-3.5 w-3.5" />
              Remove
            </button>
          </div>
        </div>

        {competitor.rationale && (
          <p className="rounded-xl bg-muted/60 px-3 py-2 text-[12.5px] leading-relaxed text-muted-foreground">
            Why we think they compete with you: {competitor.rationale}
          </p>
        )}

        {researching && (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Spinner className="h-3.5 w-3.5 animate-spin" />
            Reading their website and recent coverage…
          </p>
        )}

        {competitor.profileStatus === "failed" && (
          <div
            role="alert"
            className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive"
          >
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{competitor.profileError ?? "We couldn't read this website."}</span>
          </div>
        )}

        {profile && (
          <div className="space-y-4">
            <Field label="What they do" value={profile.summary} />
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldList label="Products and services" items={profile.products} />
              <Field label="Who they sell to" value={profile.targetCustomers} />
              <Field label="How they position themselves" value={profile.positioning} />
              <Field label="Pricing signals" value={profile.pricingSignals} />
            </div>
            <FieldList label="Company facts" items={profile.companyFacts} icon={CheckCircle} />
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldList label="Strengths" items={profile.strengths} />
              <FieldList label="Weaknesses" items={profile.weaknesses} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldList label="What sets them apart" items={profile.differentiators} />
              <FieldList label="What they write about" items={profile.contentThemes} />
            </div>

            {profile.evidence.length > 0 && (
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Evidence
                </div>
                <ul className="mt-1.5 space-y-1.5">
                  {profile.evidence.map((item, index) => (
                    <li
                      key={`${item.source}-${index}`}
                      className="rounded-xl border border-border/50 bg-muted/40 px-3 py-2"
                    >
                      <p className="text-[12.5px] leading-relaxed text-foreground/90">
                        “{item.claim}”
                      </p>
                      {item.source && (
                        <a
                          href={item.source}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {item.source}
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <SourceChips sources={profile.sources} limit={6} />
              {profile.pagesRead.length > 0 && (
                <Chip tone="muted">
                  {profile.pagesRead.length} page{profile.pagesRead.length === 1 ? "" : "s"} read
                </Chip>
              )}
              {competitor.profileUpdatedAt && (
                <span className="text-[11.5px] text-muted-foreground">
                  Researched {relativeTime(competitor.profileUpdatedAt)}
                </span>
              )}
            </div>
          </div>
        )}
      </Card>

      <div>
        <h3 className="mb-2 text-[14px] font-semibold tracking-tight text-foreground">
          What changed
        </h3>
        {updates.length ? (
          <div className="space-y-2">
            {updates.map((update) => (
              <UpdateRow key={update.id} update={update} showCompetitor={false} />
            ))}
          </div>
        ) : (
          <EmptyState
            size="sm"
            title="Nothing new yet"
            description={
              competitor.updatesCheckedAt
                ? `We last looked ${relativeTime(competitor.updatesCheckedAt)}. We check regularly and only tell you about real changes.`
                : "We'll check regularly and only tell you about real changes."
            }
          />
        )}
      </div>
    </section>
  );
}
