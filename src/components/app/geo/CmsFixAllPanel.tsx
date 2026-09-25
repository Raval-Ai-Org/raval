"use client";

// CmsFixAllPanel — "Fix all" on a WordPress or Webflow site.
//
//   1. Prepare   one quick GEO Engineer run per finding; each shows the exact
//                before → after for its page. Nothing changes on the site yet.
//   2. Apply     tick the changes you want and apply them in one go. Each can be
//                undone from its finding, and each finding is marked fixed only
//                after a rescan of the live page confirms it.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle, Spinner, Wand } from "@/components/icons";
import { SITE_PLATFORM_LABEL } from "@/components/brand/SiteLogos";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import type { CmsFixAllItem, CmsFixAllView } from "@/lib/geo/fix-contracts";
import { applyCmsFixAll, getCmsFixAll, startCmsFixAll } from "@/lib/geo-fixes.functions";
import { cn } from "@/lib/utils";
import { BeforeAfter } from "./agent/AgentPanel";
import { pathOf } from "./geo-ui";

const WORKING = [
  "queued",
  "investigating",
  "implementing",
  "reviewing",
  "validating",
  "correcting",
  "applying",
];
const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

type Phase = "working" | "ready" | "applied" | "checking" | "fixed" | "paste" | "skipped" | "none";

function phaseOf(item: CmsFixAllItem): Phase {
  const r = item.run;
  if (!r) return "none";
  if (WORKING.includes(r.status)) return "working";
  if (r.proposalId && r.contentHash) return "ready";
  if (r.status === "verified_fixed") return "fixed";
  if (r.applied && ["rescan_pending", "merged"].includes(r.status)) return "checking";
  if (r.applied) return "applied";
  if (r.assistedCount > 0) return "paste";
  return "skipped";
}

const LABEL: Record<Phase, string> = {
  working: "Preparing",
  ready: "Ready",
  applied: "Changed",
  checking: "Changed · checking the live page",
  fixed: "Fixed",
  paste: "Needs a quick paste",
  skipped: "Can't be changed automatically",
  none: "Not started",
};

export function CmsFixAllPanel({
  workspaceId,
  scanId,
  onChanged,
  onOpenFinding,
}: {
  workspaceId: string;
  scanId: string;
  onChanged: () => void;
  onOpenFinding?: (findingId: string) => void;
}) {
  const [view, setView] = useState<CmsFixAllView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"start" | "apply" | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await getCmsFixAll({ data: { workspaceId, scanId } }));
      setError(null);
    } catch (e) {
      setError(errMsg(e, "Couldn't load the fixes"));
    }
  }, [workspaceId, scanId]);

  useEffect(() => {
    void load();
  }, [load]);

  const phases = view?.items.map(phaseOf) ?? [];
  const working = phases.includes("working") || phases.includes("checking");
  useVisibleInterval(() => void (working && load()), 4000, [working]);

  if (error && !view) return <ErrorState size="sm" detail={error} onRetry={() => void load()} />;
  if (!view) return <Skeleton className="h-40 w-full rounded-xl" />;

  const platform = SITE_PLATFORM_LABEL[view.provider];
  if (!view.items.length)
    return (
      <p className="rounded-xl bg-muted/40 px-4 py-3 text-[12.5px] text-muted-foreground">
        Nothing in this scan can be changed on {platform} automatically. Open a finding for its
        steps.
      </p>
    );

  const ready = view.items.filter((i, k) => phases[k] === "ready" && !skip.has(i.findingId));
  const started = phases.some((p) => p !== "none");
  const publishes = ready.some((i) => i.run?.publishesSite);

  const start = async () => {
    setBusy("start");
    try {
      setView(await startCmsFixAll({ data: { workspaceId, scanId } }));
    } catch (e) {
      toast.error(errMsg(e, "Couldn't start"));
    } finally {
      setBusy(null);
    }
  };
  const apply = async () => {
    setBusy("apply");
    try {
      const r = await applyCmsFixAll({
        data: {
          workspaceId,
          scanId,
          items: ready.map((i) => ({
            proposalId: i.run!.proposalId!,
            contentHash: i.run!.contentHash!,
          })),
        },
      });
      setView(r.view);
      const failed = r.results.filter((x) => !x.ok);
      if (failed.length)
        toast.error(`${failed.length} change(s) didn't apply`, {
          description: failed[0].error ?? undefined,
        });
      else
        toast.success(`Changed ${r.results.length} on ${platform}. Checking the live pages now.`);
      onChanged();
    } catch (e) {
      toast.error(errMsg(e, "Couldn't apply the changes"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
        {view.items.map((item, k) => {
          const phase = phases[k];
          const changes = item.run?.changes ?? [];
          const expanded = open === item.findingId;
          return (
            <li key={item.findingId} className="bg-card/40">
              <div className="flex min-w-0 items-center gap-2.5 px-3 py-2.5">
                {phase === "ready" ? (
                  <input
                    type="checkbox"
                    aria-label={`Apply: ${item.title}`}
                    checked={!skip.has(item.findingId)}
                    onChange={(e) =>
                      setSkip((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.delete(item.findingId);
                        else n.add(item.findingId);
                        return n;
                      })
                    }
                  />
                ) : phase === "working" || phase === "checking" ? (
                  <Spinner className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                ) : phase === "fixed" || phase === "applied" ? (
                  <CheckCircle className="size-3.5 shrink-0 text-success" />
                ) : phase === "paste" ? (
                  <AlertTriangle className="size-3.5 shrink-0 text-warning" />
                ) : (
                  <span className="size-3.5 shrink-0 rounded-full border border-border" />
                )}
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() =>
                    changes.length
                      ? setOpen(expanded ? null : item.findingId)
                      : onOpenFinding?.(item.findingId)
                  }
                >
                  <span className="block truncate text-[12.5px] font-medium">{item.title}</span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {pathOf(item.pageUrl)}
                  </span>
                </button>
                <span
                  className={cn(
                    "shrink-0 text-[11.5px]",
                    phase === "ready" || phase === "fixed"
                      ? "text-primary"
                      : "text-muted-foreground",
                  )}
                >
                  {LABEL[phase]}
                </span>
              </div>
              {expanded && changes.length ? (
                <div className="space-y-3 border-t border-border/50 px-3 py-3">
                  {changes.map((c) => (
                    <BeforeAfter key={c.label + c.target} change={c} />
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {view.deferred > 0 ? (
        <p className="text-[11.5px] text-muted-foreground">
          {view.deferred} more change the same fields, so they'll be ready on the next run.
        </p>
      ) : null}

      {!view.canPropose ? (
        <p className="text-[12px] text-muted-foreground">An editor can run “Fix all”.</p>
      ) : !started || phases.includes("none") ? (
        <div className="space-y-1.5">
          <Button loading={busy === "start"} onClick={() => void start()}>
            <Wand className="size-4" /> Prepare fixes
          </Button>
          <p className="text-[11.5px] text-muted-foreground">
            You'll see every change before anything on your site is touched.
          </p>
        </div>
      ) : ready.length ? (
        <div className="space-y-2">
          {publishes ? (
            <p className="flex items-start gap-1.5 rounded-lg bg-warning/5 px-2.5 py-2 text-[11.5px] ring-1 ring-warning/30">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              Webflow publishes your whole site to make these live, including any other unpublished
              edits.
            </p>
          ) : null}
          <Button loading={busy === "apply"} onClick={() => void apply()}>
            Apply {ready.length} change{ready.length === 1 ? "" : "s"} to {platform}
          </Button>
          <p className="text-[11.5px] text-muted-foreground">
            Tap a row to see before and after. Each change can be undone from its finding.
          </p>
        </div>
      ) : working ? (
        <p className="text-[12px] text-muted-foreground">Preparing your changes…</p>
      ) : null}
    </div>
  );
}
