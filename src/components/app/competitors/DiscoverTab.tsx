"use client";
// DiscoverTab.tsx — competitors Mellox found, for the user to confirm.
//
// Nothing here is treated as true until a person says so. Each suggestion
// carries why we think it competes and the pages that made us think it, and
// the two actions are equally easy: add it, or drop it. Adding is what starts
// costing money, so it is always the user's call.
import * as React from "react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { ghostBtn, primaryBtn } from "@/components/app/geo/geo-ui";
import { Check, Compass, Globe, Plus, Search, Spinner, X } from "@/components/icons";
import { Card, RelationshipChip, SiteMark, SourceChips } from "./competitors-ui";
import type { CompetitorView } from "@/lib/competitors.functions";

export function DiscoverTab({
  suggestions,
  researchAvailable,
  discovering,
  onDiscover,
  onTrack,
  onIgnore,
  onAdd,
  adding,
  busyId,
}: {
  suggestions: CompetitorView[];
  researchAvailable: boolean;
  discovering: boolean;
  onDiscover: () => void;
  onTrack: (id: string) => void;
  onIgnore: (id: string) => void;
  onAdd: (url: string) => void;
  adding: boolean;
  busyId: string | null;
}) {
  const [url, setUrl] = React.useState("");

  const submitManual = (event: React.FormEvent) => {
    event.preventDefault();
    const value = url.trim();
    if (!value) return;
    onAdd(value);
    setUrl("");
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="flex items-center gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
            <Compass className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-foreground">Find for me</div>
            <div className="truncate text-[12.5px] text-muted-foreground">
              {researchAvailable ? "Uses your Brand DNA" : "Web search is off"}
            </div>
          </div>
          <button
            type="button"
            onClick={onDiscover}
            disabled={discovering || !researchAvailable}
            className={cn(primaryBtn, "h-9 shrink-0 px-4 text-[13px]")}
          >
            {discovering ? (
              <Spinner className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            {discovering ? "Looking" : "Find"}
          </button>
        </Card>

        <Card className="flex items-center">
          <form onSubmit={submitManual} data-no-rhythm className="flex w-full items-center gap-2">
            <label className="relative flex min-w-0 flex-1 items-center">
              <span className="sr-only">Competitor website</span>
              <Globe className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="competitor.com"
                aria-label="Competitor website"
                className="h-10 w-full rounded-full bg-foreground/[0.05] pl-10 pr-4 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-primary/30"
              />
            </label>
            <button
              type="submit"
              disabled={adding || !url.trim()}
              className={cn(ghostBtn, "h-10 shrink-0 px-4 text-[13px]")}
            >
              {adding ? (
                <Spinner className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Add
            </button>
          </form>
        </Card>
      </div>

      {suggestions.length ? (
        <section>
          <h4 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Suggested · {suggestions.length}
          </h4>
          <ul className="space-y-2">
            {suggestions.map((suggestion) => (
              <li key={suggestion.id}>
                <Card className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                  <SiteMark domain={suggestion.domain} size={40} />
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate text-[14.5px] font-semibold text-foreground">
                        {suggestion.name}
                      </span>
                      <RelationshipChip relationship={suggestion.relationship} />
                      <span className="truncate text-[12px] text-muted-foreground">
                        {suggestion.domain}
                      </span>
                    </div>
                    {suggestion.rationale && (
                      <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                        {suggestion.rationale}
                      </p>
                    )}
                    {suggestion.discoverySources.length > 0 && (
                      <div className="mt-2">
                        <SourceChips sources={suggestion.discoverySources} limit={3} />
                      </div>
                    )}
                  </div>
                  <div className="col-span-2 flex items-center gap-1.5 sm:col-span-1">
                    <button
                      type="button"
                      onClick={() => onTrack(suggestion.id)}
                      disabled={busyId === suggestion.id}
                      className={cn(primaryBtn, "h-9 flex-1 px-4 text-[12.5px] sm:flex-none")}
                    >
                      {busyId === suggestion.id ? (
                        <Spinner className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => onIgnore(suggestion.id)}
                      disabled={busyId === suggestion.id}
                      className={cn(ghostBtn, "h-9 w-9 shrink-0 px-0")}
                      aria-label={`Not a competitor: ${suggestion.name}`}
                      title="Not a competitor"
                    >
                      {busyId === suggestion.id ? (
                        <Spinner className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <EmptyState
          size="sm"
          icon={Compass}
          title="No suggestions right now"
          description="Press Find, or add one by website."
        />
      )}
    </div>
  );
}
