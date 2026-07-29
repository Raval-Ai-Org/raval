import { lazy, Suspense, useEffect, useState } from "react";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Sparkles } from "@/components/ui/gemini-icons";

const GeoAeoPanel = lazy(() =>
  import("@/components/app/GeoAeoPanel").then((m) => ({ default: m.GeoAeoPanel })),
);

/**
 * Global "AI Visibility" popup. Opens whenever `window.dispatchEvent(new
 * CustomEvent("open:ai-visibility"))` fires — from the sidebar entry, the
 * chat's AI Diagnostics row, or any other surface. Shows the full GeoAeo /
 * technical diagnostics panel in a large modal.
 */
export function AiVisibilityDialog({ workspaceId }: { workspaceId: string | null }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openFn = () => setOpen(true);
    const toggleFn = () => setOpen((v) => !v);
    window.addEventListener("open:ai-visibility", openFn as EventListener);
    window.addEventListener("toggle:ai-visibility", toggleFn as EventListener);
    return () => {
      window.removeEventListener("open:ai-visibility", openFn as EventListener);
      window.removeEventListener("toggle:ai-visibility", toggleFn as EventListener);
    };
  }, []);

  return (
    <AppModalShell
      open={open}
      onOpenChange={setOpen}
      size="xl"
      Icon={Sparkles}
      eyebrow="Intelligence"
      title="AI Visibility"
      description="Full technical, GEO & AEO diagnostics — see how ChatGPT, Gemini, Claude and Perplexity read, index and cite your site."
      srDescription="AI visibility diagnostics dashboard"
      bodyClassName="px-2 py-2 sm:px-4 sm:py-4"
    >
      <Suspense
        fallback={
          <div className="grid place-items-center py-24 text-sm text-muted-foreground">
            Loading AI visibility diagnostics…
          </div>
        }
      >
        {workspaceId ? (
          <GeoAeoPanel workspaceId={workspaceId} />
        ) : (
          <div className="grid place-items-center py-24 text-sm text-muted-foreground">
            Select a workspace to run a scan.
          </div>
        )}
      </Suspense>
    </AppModalShell>
  );
}
