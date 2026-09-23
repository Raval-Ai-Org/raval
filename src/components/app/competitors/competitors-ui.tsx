"use client";
// competitors-ui.tsx — the small shared pieces of the Competitors surface.
//
// Everything visual is borrowed rather than reinvented: tone chips, buttons
// and formatting come from the GEO kit (src/components/app/geo/geo-ui.tsx),
// icons from @/components/icons, colour from design tokens only. A source
// chip is the one thing specific to this surface, because it is the rule the
// whole feature rests on — a claim shows where it came from, or it isn't shown.
import * as React from "react";
import { cn } from "@/lib/utils";
import { Chip, TONE, hostOf, relativeTime } from "@/components/app/geo/geo-ui";
import { SiteIcon } from "@/components/app/surface/SiteIcon";
import { ExternalLink, Tag } from "@/components/icons";
import {
  RELATIONSHIP_LABELS,
  type CompetitorRelationship,
  type CompetitorSourceLink,
} from "@/lib/competitors.functions";

export { hostOf, relativeTime };

const RELATIONSHIP_TONE: Record<CompetitorRelationship, keyof typeof TONE> = {
  direct: "destructive",
  indirect: "warning",
  alternative: "primary",
  unknown: "muted",
};

export function RelationshipChip({ relationship }: { relationship: CompetitorRelationship }) {
  return <Chip tone={RELATIONSHIP_TONE[relationship]}>{RELATIONSHIP_LABELS[relationship]}</Chip>;
}

/** The site's own icon (shared with Backlinks). */
export function SiteMark({ domain, size = 32 }: { domain: string; size?: number }) {
  return <SiteIcon domain={domain} size={size} />;
}

/** Where a claim came from. Clicking it opens the page it was read from. */
export function SourceChip({ source }: { source: CompetitorSourceLink }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer noopener"
      title={source.title}
      className={cn(
        "inline-flex max-w-[180px] items-center gap-1 rounded-full border border-border/60 bg-card/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground",
        "transition-colors hover:border-foreground/20 hover:text-foreground",
      )}
    >
      <span className="truncate">{hostOf(source.url)}</span>
      <ExternalLink className="h-2.5 w-2.5 shrink-0" />
    </a>
  );
}

export function SourceChips({
  sources,
  limit = 4,
}: {
  sources: CompetitorSourceLink[];
  limit?: number;
}) {
  if (!sources.length) return null;
  const shown = sources.slice(0, limit);
  const extra = sources.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Sources">
      {shown.map((source) => (
        <SourceChip key={source.url} source={source} />
      ))}
      {extra > 0 && <span className="text-[11px] text-muted-foreground">+{extra}</span>}
    </div>
  );
}

/** A labelled block of profile text. Renders nothing when there is nothing to say. */
export function Field({
  label,
  value,
  className,
}: {
  label: string;
  value: string | null | undefined;
  className?: string;
}) {
  if (!value?.trim()) return null;
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[12px] font-medium text-muted-foreground">{label}</div>
      <p className="mt-1 text-[13.5px] leading-relaxed text-foreground/90">{value}</p>
    </div>
  );
}

/** A labelled list. Renders nothing when the list is empty. */
export function FieldList({
  label,
  items,
  icon: Icon = Tag,
  max = 6,
}: {
  label: string;
  items: string[];
  icon?: React.ComponentType<{ className?: string }>;
  max?: number;
}) {
  if (!items.length) return null;
  return (
    <div className="min-w-0">
      <div className="text-[12px] font-medium text-muted-foreground">{label}</div>
      <ul className="mt-1.5 space-y-1">
        {items.slice(0, max).map((item) => (
          <li key={item} className="flex gap-1.5 text-[13px] leading-relaxed text-foreground/90">
            <Icon className="mt-[3px] h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Card({ children, className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[20px] border border-border/50 bg-surface-3 p-4 dark:border-white/[0.06] dark:bg-white/[0.035] sm:p-5",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
