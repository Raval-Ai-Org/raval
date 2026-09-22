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
import { Input } from "@/components/ui/input";
import { ghostBtn, primaryBtn } from "@/components/app/geo/geo-ui";
import { Check, Compass, Plus, Search, Spinner, XCircle } from "@/components/icons";
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
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold tracking-tight text-foreground">
              Find competitors
            </h3>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              We use what we know about your business to search the web for companies like yours.
            </p>
          </div>
          <button
            type="button"
            onClick={onDiscover}
            disabled={discovering || !researchAvailable}
            className={cn(primaryBtn, "h-9 px-4 text-[13px]")}
          >
            {discovering ? (
              <Spinner className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            {discovering ? "Looking…" : "Find competitors"}
          </button>
        </div>
        {!researchAvailable && (
          <p
            role="status"
            className="rounded-xl bg-muted/60 px-3 py-2 text-[12.5px] text-muted-foreground"
          >
            Web research isn&apos;t set up on this server yet, so we can&apos;t search for you. You
            can still add competitors by hand.
          </p>
        )}
      </Card>

      <Card className="space-y-2">
        <h3 className="text-[14px] font-semibold tracking-tight text-foreground">
          Add one yourself
        </h3>
        <form onSubmit={submitManual} className="flex flex-wrap gap-2">
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="competitor.com"
            aria-label="Competitor website"
            className="h-9 min-w-[200px] flex-1 text-[13px]"
          />
          <button
            type="submit"
            disabled={adding || !url.trim()}
            className={cn(ghostBtn, "h-9 px-3.5 text-[13px]")}
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

      {suggestions.length ? (
        <div className="space-y-2">
          <h3 className="text-[14px] font-semibold tracking-tight text-foreground">
            We found these
          </h3>
          {suggestions.map((suggestion) => (
            <Card key={suggestion.id} className="flex min-w-0 gap-3">
              <SiteMark domain={suggestion.domain} size={36} />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-[14px] font-semibold text-foreground">
                    {suggestion.name}
                  </span>
                  <RelationshipChip relationship={suggestion.relationship} />
                  <span className="text-[11.5px] text-muted-foreground">{suggestion.domain}</span>
                </div>
                {suggestion.rationale && (
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                    {suggestion.rationale}
                  </p>
                )}
                <SourceChips sources={suggestion.discoverySources} limit={3} />
              </div>
              <div className="flex shrink-0 flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => onTrack(suggestion.id)}
                  disabled={busyId === suggestion.id}
                  className={cn(primaryBtn, "h-7 px-2.5 text-[12px]")}
                >
                  <Check className="h-3 w-3" />
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => onIgnore(suggestion.id)}
                  disabled={busyId === suggestion.id}
                  className={cn(ghostBtn, "h-7 px-2.5 text-[12px]")}
                >
                  <XCircle className="h-3 w-3" />
                  Not one
                </button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          size="sm"
          icon={Compass}
          title="No suggestions right now"
          description="Run a search, or add a competitor by hand above."
        />
      )}
    </div>
  );
}
