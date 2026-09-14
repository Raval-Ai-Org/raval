"use client";

import { addAppEventListener, removeAppEventListener } from "@/lib/app-events";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Sparkles } from "@/components/ui/gemini-icons";
import { takePendingGeoRun } from "@/lib/geo/pending-run";

const GeoAeoPanel = lazy(() =>
  import("@/components/app/GeoAeoPanel").then((m) => ({ default: m.GeoAeoPanel })),
);

/**
 * Global "AI Visibility" popup — Mellox's GEO / AEO / SEO intelligence surface.
 * Opens on `open:ai-visibility` (sidebar, account menu, Analytics) and starts a
 * scan on `geo:run-audit` (chat tools, chat actions, Studio suggestions).
 */
export function AiVisibilityDialog({ workspaceId }: { workspaceId: string | null }) {
  const [open, setOpen] = useState(false);
  // Non-zero while a chat/suggestion scan request waits for the panel to start it.
  const [runToken, setRunToken] = useState(0);

  const requestRun = useCallback(() => {
    setOpen(true);
    setRunToken((n) => n + 1);
  }, []);

  useEffect(() => {
    const openFn = () => setOpen(true);
    const toggleFn = () => setOpen((v) => !v);
    const runFn = () => {
      takePendingGeoRun(); // handled here; don't replay it on a later mount
      requestRun();
    };
    // "Ask Ravi" and "Add it in Brand DNA" hand off to another surface —
    // close so that surface is visible instead of hidden behind this modal.
    const closeFn = () => setOpen(false);
    addAppEventListener("open:ai-visibility", openFn);
    addAppEventListener("toggle:ai-visibility", toggleFn);
    addAppEventListener("geo:run-audit", runFn);
    addAppEventListener("chat:prefill", closeFn);
    addAppEventListener("open:brand-dna", closeFn);
    // A request that arrived before this code-split dialog finished loading.
    if (takePendingGeoRun()) requestRun();
    return () => {
      removeAppEventListener("open:ai-visibility", openFn);
      removeAppEventListener("toggle:ai-visibility", toggleFn);
      removeAppEventListener("geo:run-audit", runFn);
      removeAppEventListener("chat:prefill", closeFn);
      removeAppEventListener("open:brand-dna", closeFn);
    };
  }, [requestRun]);

  return (
    <AppModalShell
      open={open}
      onOpenChange={setOpen}
      size="xl"
      Icon={Sparkles}
      eyebrow="Intelligence"
      title="AI Visibility"
      description="Can ChatGPT, Claude, Gemini and Perplexity read, understand and cite your site? Scan it, track it and apply fixes."
      srDescription="AI visibility intelligence: site scans, findings, page evidence and monitoring"
      bodyClassName="px-3 py-3 sm:px-5 sm:py-5"
    >
      <Suspense
        fallback={
          <div className="grid place-items-center py-24 text-sm text-muted-foreground">
            Loading AI visibility…
          </div>
        }
      >
        {workspaceId ? (
          <GeoAeoPanel
            workspaceId={workspaceId}
            autoRunToken={runToken}
            onAutoRunHandled={() => setRunToken(0)}
          />
        ) : (
          <div className="grid place-items-center py-24 text-sm text-muted-foreground">
            Select a workspace to run a scan.
          </div>
        )}
      </Suspense>
    </AppModalShell>
  );
}
