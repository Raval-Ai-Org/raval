"use client";
// CompetitorDetail.tsx — everything Mellox found about one competitor, with
// the evidence attached.
//
// The order is the order a person asks: who are they, what do they sell, who
// to, how do they position it, what is strong and weak — then what changed,
// then the raw evidence (folded away). Interpretation is visually separated
// from measured evidence, which is the same discipline the prompts are held to.
import * as React from "react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { Chip, ghostBtn, primaryBtn, relativeTime } from "@/components/app/geo/geo-ui";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  RefreshCw,
  Spinner,
  ThumbsDown,
  ThumbsUp,
  Trash,
} from "@/components/icons";
import { Card, Field, FieldList, RelationshipChip, SiteMark, SourceChips } from "./competitors-ui";
import { UpdateRow } from "./UpdatesFeed";
import type { CompetitorUpdateView, CompetitorView } from "@/lib/competitors.functions";

function PointList({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: "success" | "destructive";
}) {
  if (!items.length) return null;
  const Icon = tone === "success" ? ThumbsUp : ThumbsDown;
  return (
    <div
      className={cn(
        "rounded-[20px] p-4 sm:p-5",
        tone === "success" ? "bg-success/[0.07]" : "bg-destructive/[0.07]",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 text-[13px] font-semibold",
          tone === "success" ? "text-success" : "text-destructive",
        )}
      >
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.slice(0, 5).map((item) => (
          <li key={item} className="text-[13.5px] leading-relaxed text-foreground/90">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

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
  const [showEvidence, setShowEvidence] = React.useState(false);

  return (
    <section aria-label={`${competitor.name} details`} className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All competitors
      </button>

      <div className="flex min-w-0 flex-wrap items-center gap-4">
        <SiteMark domain={competitor.domain} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[22px] font-semibold tracking-tight text-foreground">
              {competitor.name}
            </h3>
            <RelationshipChip relationship={competitor.relationship} />
          </div>
          <a
            href={competitor.url ?? `https://${competitor.domain}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-primary"
          >
            {competitor.domain}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onRefresh(true)}
            disabled={refreshing || researching}
            className={cn(primaryBtn, "h-9 px-4 text-[13px]")}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Research again
          </button>
          <button
            type="button"
            onClick={onRemove}
            className={cn(ghostBtn, "h-9 w-9 px-0")}
            aria-label={`Remove ${competitor.name}`}
            title="Remove"
          >
            <Trash className="h-4 w-4" />
          </button>
        </div>
      </div>

      {competitor.rationale && (
        <p className="rounded-2xl bg-foreground/[0.04] px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground/85">Why they compete: </span>
          {competitor.rationale}
        </p>
      )}

      {researching && (
        <Card className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Spinner className="h-4 w-4 animate-spin" />
          Reading their website and recent news…
        </Card>
      )}

      {competitor.profileStatus === "failed" && (
        <div
          role="alert"
          className="flex gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-[13px] text-destructive"
        >
          <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
          <span>{competitor.profileError ?? "We couldn't read this website."}</span>
        </div>
      )}

      {profile && (
        <>
          <Card className="space-y-5">
            <Field label="What they do" value={profile.summary} />
            {profile.products.length > 0 && (
              <div>
                <div className="text-[12px] font-medium text-muted-foreground">Products</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {profile.products.slice(0, 10).map((product) => (
                    <span
                      key={product}
                      className="rounded-full bg-foreground/[0.06] px-3 py-1 text-[12.5px] font-medium text-foreground/80"
                    >
                      {product}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Customers" value={profile.targetCustomers} />
              <Field label="Positioning" value={profile.positioning} />
              <Field label="Pricing" value={profile.pricingSignals} />
            </div>
          </Card>

          {(profile.strengths.length > 0 || profile.weaknesses.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <PointList label="Strengths" items={profile.strengths} tone="success" />
              <PointList label="Weaknesses" items={profile.weaknesses} tone="destructive" />
            </div>
          )}

          {(profile.differentiators.length > 0 ||
            profile.contentThemes.length > 0 ||
            profile.companyFacts.length > 0) && (
            <Card className="grid gap-5 sm:grid-cols-3">
              <FieldList label="Stands out for" items={profile.differentiators} max={4} />
              <FieldList label="Writes about" items={profile.contentThemes} max={4} />
              <FieldList label="Facts" items={profile.companyFacts} max={4} />
            </Card>
          )}
        </>
      )}

      <div>
        <h4 className="mb-1 px-1 text-[15px] font-semibold tracking-tight text-foreground">
          What changed
        </h4>
        {updates.length ? (
          <div className="space-y-1">
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
                ? `Last checked ${relativeTime(competitor.updatesCheckedAt)}.`
                : "We check regularly."
            }
          />
        )}
      </div>

      {profile && (profile.evidence.length > 0 || profile.sources.length > 0) && (
        <div>
          <button
            type="button"
            aria-expanded={showEvidence}
            onClick={() => setShowEvidence((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] font-medium text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
          >
            Sources and evidence
            {profile.pagesRead.length > 0 && (
              <Chip tone="muted">{profile.pagesRead.length} pages read</Chip>
            )}
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", showEvidence && "rotate-180")}
            />
          </button>
          {showEvidence && (
            <div className="mt-2 space-y-3">
              <SourceChips sources={profile.sources} limit={8} />
              {profile.evidence.length > 0 && (
                <ul className="space-y-1.5">
                  {profile.evidence.map((item, index) => (
                    <li
                      key={`${item.source}-${index}`}
                      className="rounded-2xl bg-foreground/[0.04] px-4 py-3"
                    >
                      <p className="text-[13px] leading-relaxed text-foreground/90">
                        “{item.claim}”
                      </p>
                      {item.source && (
                        <a
                          href={item.source}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="mt-1 inline-flex max-w-full items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-primary"
                        >
                          <span className="truncate">{item.source}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {competitor.profileUpdatedAt && (
                <p className="text-[12px] text-muted-foreground">
                  Researched {relativeTime(competitor.profileUpdatedAt)}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
