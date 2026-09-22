"use client";
// CompetitorStep.tsx — the last beat of onboarding: who you're up against.
//
// It runs straight after Brand DNA is saved, because that is the moment Mellox
// first understands the business well enough to search usefully. It is a
// separate step rather than part of the scan so a slow search can never hold
// up the reveal, and it is always skippable: nothing here is required to use
// the product.
//
// Nothing is added without the user saying so. Each suggestion shows why we
// think it competes and links the pages that made us think it, so the decision
// is theirs to make on evidence rather than on trust.
import * as React from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Check, Compass, ExternalLink, Plus, Spinner } from "@/components/icons";
import {
  addCompetitor,
  discoverCompetitors,
  trackCompetitors,
  type CompetitorView,
} from "@/lib/competitors.functions";

export function CompetitorStep({
  workspaceId,
  reduce,
  headingRef,
  onContinue,
}: {
  workspaceId: string;
  reduce: boolean;
  headingRef?: React.RefObject<HTMLHeadingElement | null>;
  onContinue: () => void;
}) {
  const [loading, setLoading] = React.useState(true);
  const [available, setAvailable] = React.useState(true);
  const [suggestions, setSuggestions] = React.useState<CompetitorView[]>([]);
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  const [manualUrl, setManualUrl] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await discoverCompetitors({ data: { workspaceId } });
        if (cancelled) return;
        setAvailable(result.available);
        setSuggestions(result.suggestions);
        // Pre-select the confident ones: the common case is "yes, those are
        // them", and the user can untick anything that isn't.
        setChosen(
          new Set(
            result.suggestions
              .filter((suggestion) => suggestion.confidence >= 0.6)
              .map((suggestion) => suggestion.id),
          ),
        );
      } catch {
        // A failed search must not block finishing setup.
        if (!cancelled) setAvailable(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addManual = async (event: React.FormEvent) => {
    event.preventDefault();
    const url = manualUrl.trim();
    if (!url || adding) return;
    setAdding(true);
    try {
      const competitor = await addCompetitor({ data: { workspaceId, url } });
      setSuggestions((current) =>
        current.some((entry) => entry.id === competitor.id) ? current : [competitor, ...current],
      );
      setChosen((current) => new Set(current).add(competitor.id));
      setManualUrl("");
    } catch (error) {
      toast.error("We couldn't add that", {
        description: error instanceof Error ? error.message : "Check the address and try again.",
      });
    } finally {
      setAdding(false);
    }
  };

  const finish = async () => {
    if (saving) return;
    const ids = [...chosen];
    if (!ids.length) {
      onContinue();
      return;
    }
    setSaving(true);
    try {
      await trackCompetitors({ data: { workspaceId, competitorIds: ids } });
    } catch {
      // They can add these later from the Competitors page; nothing is lost
      // and setup should not stall on it.
      toast.error("We couldn't save all of those", {
        description: "You can add them later from Competitors.",
      });
    } finally {
      setSaving(false);
      onContinue();
    }
  };

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-5"
      aria-label="Competitors"
    >
      <header className="space-y-1.5">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-balance text-2xl font-semibold tracking-tight outline-none sm:text-3xl"
        >
          Who you&apos;re up against
        </h1>
        <p className="text-[14px] leading-relaxed text-muted-foreground">
          {loading
            ? "Looking for companies like yours…"
            : available
              ? "Pick the ones that are really competitors. We'll keep an eye on them and tell you when something changes."
              : "We couldn't search just now. Add a competitor yourself, or skip and do it later."}
        </p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-card p-5 text-[13.5px] text-muted-foreground">
          <Spinner className="h-4 w-4 animate-spin" />
          Searching the web
        </div>
      ) : suggestions.length ? (
        <ul className="space-y-2">
          {suggestions.map((suggestion) => {
            const picked = chosen.has(suggestion.id);
            return (
              <li key={suggestion.id}>
                <button
                  type="button"
                  onClick={() => toggle(suggestion.id)}
                  aria-pressed={picked}
                  className={cn(
                    "flex w-full min-w-0 items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors",
                    picked
                      ? "border-primary/50 bg-primary/5"
                      : "border-border/60 bg-card hover:border-foreground/20",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors",
                      picked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border/70",
                    )}
                  >
                    {picked && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-wrap items-baseline gap-2">
                      <span className="truncate text-[14px] font-semibold text-foreground">
                        {suggestion.name}
                      </span>
                      <span className="text-[12px] text-muted-foreground">{suggestion.domain}</span>
                    </span>
                    {suggestion.rationale && (
                      <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted-foreground">
                        {suggestion.rationale}
                      </span>
                    )}
                  </span>
                </button>
                {suggestion.discoverySources.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5 pl-11">
                    {suggestion.discoverySources.slice(0, 2).map((source) => (
                      <a
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      >
                        {source.title.slice(0, 48)}
                        <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                      </a>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex items-center gap-2.5 rounded-2xl border border-border/60 bg-card p-5 text-[13.5px] text-muted-foreground">
          <Compass className="h-4 w-4 shrink-0" />
          {available
            ? "We didn't find anyone this time. Add one yourself below, or skip."
            : "Add a competitor yourself below, or skip."}
        </div>
      )}

      <form onSubmit={addManual} className="flex flex-wrap gap-2">
        <Input
          value={manualUrl}
          onChange={(event) => setManualUrl(event.target.value)}
          placeholder="Add one we missed — competitor.com"
          aria-label="Competitor website"
          className="h-10 min-w-[220px] flex-1 text-[14px]"
        />
        <button
          type="submit"
          disabled={adding || !manualUrl.trim()}
          className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border/70 bg-card px-4 text-[13.5px] font-medium transition-colors hover:border-foreground/20 hover:bg-secondary disabled:pointer-events-none disabled:opacity-50"
        >
          {adding ? (
            <Spinner className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Add
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <button
          type="button"
          onClick={onContinue}
          className="text-[13.5px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          Skip for now
        </button>
        <button
          type="button"
          onClick={() => void finish()}
          disabled={saving || loading}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {saving && <Spinner className="h-4 w-4 animate-spin" />}
          {chosen.size ? `Watch ${chosen.size}` : "Continue"}
        </button>
      </div>
    </motion.section>
  );
}
