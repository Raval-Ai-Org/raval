"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Video } from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { addAppEventListener, removeAppEventListener, type AppEvent } from "@/lib/app-events";

const UgcStudio = lazy(() => import("./UgcStudio").then((m) => ({ default: m.UgcStudio })));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "UGC Video Ads" studio popup. Opens on `open:ugc-studio` (sidebar, rail,
 * command bar) and on the deep link `?ugc=new|<projectId>`.
 */
export function UgcStudioDialog({ workspaceId }: { workspaceId: string | null }) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [session, setSession] = useState(0);

  useEffect(() => {
    const onOpen = (event: AppEvent<"open:ugc-studio">) => {
      setProjectId(event.detail?.projectId ?? null);
      setSession((n) => n + 1);
      setOpen(true);
    };
    const onClose = () => setOpen(false);
    addAppEventListener("open:ugc-studio", onOpen);
    addAppEventListener("open:content-item", onClose);
    addAppEventListener("open:library", onClose);
    const url = new URL(window.location.href);
    const deep = url.searchParams.get("ugc");
    if (deep) {
      setProjectId(UUID_RE.test(deep) ? deep : null);
      setOpen(true);
      url.searchParams.delete("ugc");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    return () => {
      removeAppEventListener("open:ugc-studio", onOpen);
      removeAppEventListener("open:content-item", onClose);
      removeAppEventListener("open:library", onClose);
    };
  }, []);

  return (
    <AppModalShell
      open={open}
      onOpenChange={setOpen}
      size="xl"
      Icon={Video}
      title="UGC Video Ads"
      description="Product page to creator-style video ad"
      srDescription="Create AI UGC video ads: product analysis, concepts, script and video generation"
      bodyClassName="px-4 pt-4 sm:px-6 sm:pt-5"
    >
      {open ? (
        <Suspense
          fallback={
            <div className="space-y-3">
              <Skeleton className="h-28 rounded-2xl" />
              <Skeleton className="h-40 rounded-2xl" />
            </div>
          }
        >
          {workspaceId ? (
            <UgcStudio key={session} workspaceId={workspaceId} initialProjectId={projectId} />
          ) : (
            <div className="grid place-items-center py-24 text-sm text-muted-foreground">
              Select a workspace to create video ads.
            </div>
          )}
        </Suspense>
      ) : null}
    </AppModalShell>
  );
}
