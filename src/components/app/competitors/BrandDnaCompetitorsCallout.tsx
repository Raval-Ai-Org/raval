"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ExternalLink, Plus, Search, Spinner, X } from "@/components/icons";
import { SiteIcon } from "@/components/app/surface/SiteIcon";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { bootstrapCompetitors } from "@/lib/competitors.functions";
import { useAddCompetitor, useCompetitorOverview, useSetCompetitorStatus } from "./hooks";

/** Research and source-backed companies live inside Brand DNA's existing tile. */
export function BrandDnaCompetitorsCallout() {
  const workspaceId = useOptionalWorkspaceId();
  const overview = useCompetitorOverview(workspaceId);
  const add = useAddCompetitor(workspaceId);
  const setStatus = useSetCompetitorStatus(workspaceId);
  const [searching, setSearching] = useState(false);
  const [website, setWebsite] = useState("");
  if (!workspaceId) return null;

  const competitors = overview.data?.competitors.slice(0, 6) ?? [];
  const retry = async () => {
    if (searching) return;
    setSearching(true);
    try {
      await bootstrapCompetitors({ data: { workspaceId } });
      await overview.refetch();
    } catch (error) {
      toast.error("Competitor research couldn't finish", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSearching(false);
    }
  };
  const addWebsite = async (event: FormEvent) => {
    event.preventDefault();
    const url = website.trim();
    if (!url || add.isPending) return;
    try {
      await add.mutateAsync({ url });
      setWebsite("");
    } catch {
      // The mutation presents its own error toast.
    }
  };

  return (
    <section
      className="rounded-2xl border border-border/70 bg-card/50 p-3.5"
      aria-label="Research findings"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[12.5px] font-semibold">Research findings</p>
          <p className="text-[11.5px] text-muted-foreground">
            {overview.isLoading
              ? "Loading companies…"
              : competitors.length
                ? `${competitors.length} company websites found from public sources`
                : "Mellox can find company websites from your Brand DNA."}
          </p>
        </div>
        {competitors.length < 3 && (
          <button
            type="button"
            onClick={() => void retry()}
            disabled={searching || overview.isLoading}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-[11.5px] font-medium transition hover:bg-secondary disabled:opacity-50"
          >
            {searching ? (
              <Spinner className="h-3 w-3 animate-spin" />
            ) : (
              <Search className="h-3 w-3" />
            )}
            {searching ? "Researching" : competitors.length ? "Find more" : "Find competitors"}
          </button>
        )}
      </div>
      {competitors.length > 0 && (
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {competitors.map((competitor) => (
            <li
              key={competitor.id}
              className="min-w-0 rounded-xl border border-border/60 bg-background/70 px-2.5 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <SiteIcon domain={competitor.domain} size={27} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium">{competitor.name}</p>
                  <p className="truncate text-[10.5px] text-muted-foreground">
                    {competitor.domain}
                  </p>
                </div>
                <a
                  href={competitor.url ?? `https://${competitor.domain}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`Open ${competitor.name} website`}
                  className="text-muted-foreground transition hover:text-primary"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <button
                  type="button"
                  onClick={() =>
                    setStatus.mutate({ competitorId: competitor.id, status: "ignored" })
                  }
                  disabled={setStatus.isPending}
                  aria-label={`Remove ${competitor.name} from competitors`}
                  title="Remove from competitors"
                  className="text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {(competitor.profile?.summary || competitor.rationale) && (
                <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                  {competitor.profile?.summary || competitor.rationale}
                </p>
              )}
              {competitor.discoverySources[0] && (
                <a
                  href={competitor.discoverySources[0].url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1 inline-block text-[10.5px] font-medium text-primary hover:underline"
                >
                  View source
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(event) => void addWebsite(event)}
        className="mt-3 flex items-center gap-2 border-t border-border/60 pt-3"
      >
        <input
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
          aria-label="Competitor website"
          placeholder="Add a competitor website"
          className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 text-[11.5px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        <button
          type="submit"
          disabled={!website.trim() || add.isPending}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-[11.5px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {add.isPending ? (
            <Spinner className="h-3 w-3 animate-spin" />
          ) : (
            <Plus className="h-3 w-3" />
          )}
          Add
        </button>
      </form>
    </section>
  );
}

/** A small logo preview in the Brand DNA overview grid. */
export function BrandDnaCompetitorsTilePreview({ fallbackCount }: { fallbackCount: number }) {
  const workspaceId = useOptionalWorkspaceId();
  const overview = useCompetitorOverview(workspaceId);
  const competitors = overview.data?.competitors ?? [];
  if (!competitors.length) {
    return (
      <p className="text-[12px] text-muted-foreground">
        {fallbackCount ? `${fallbackCount} noted in Brand DNA` : "Market research appears here"}
      </p>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <span className="flex -space-x-1.5">
        {competitors.slice(0, 4).map((competitor) => (
          <span key={competitor.id} className="rounded-[30%] ring-2 ring-card">
            <SiteIcon domain={competitor.domain} size={29} />
          </span>
        ))}
      </span>
      <span className="text-[12px] font-medium">
        {competitors.length} researched {competitors.length === 1 ? "company" : "companies"}
      </span>
    </div>
  );
}
