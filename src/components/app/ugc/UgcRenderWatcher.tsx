"use client";

// Follows every Creator video started (or opened while running) in this tab,
// whether or not its window is still open: the corner list shows each one,
// and a finished video is announced once with a button that opens it.
// Mounted once in AppShell. It only reads renders; it never starts or pays
// for anything.

import { useEffect } from "react";
import { emitAppEvent } from "@/lib/app-events";
import { toast } from "@/lib/toast";
import { ugcApi } from "@/lib/ugc/client";
import {
  onUgcRenderTracked,
  trackedUgcRenders,
  ugcStepLabel,
  untrackUgcRender,
  type TrackedRender,
} from "@/lib/ugc/background-renders";
import { ACTIVE_RENDER_STATUSES, type RenderView } from "@/lib/ugc/schemas";

const POLL_MS = 6000;

function report(t: TrackedRender, render: RenderView | null) {
  const active = !render || ACTIVE_RENDER_STATUSES.includes(render.status);
  emitAppEvent("work:update", {
    id: `ugc:${t.renderId}`,
    title: t.title,
    state: active ? "working" : render.status === "succeeded" ? "done" : "failed",
    step: render ? ugcStepLabel(render.status) : "Sending",
    doneLabel: "Video ad ready",
    ugcProjectId: t.projectId,
  });
}

export function UgcRenderWatcher() {
  useEffect(() => {
    let timer: number | undefined;
    let running = false;
    let stopped = false;

    const tick = async () => {
      if (running || stopped) return;
      running = true;
      window.clearTimeout(timer);
      try {
        await Promise.all(
          trackedUgcRenders().map(async (t) => {
            let render: RenderView | null = null;
            try {
              render = await ugcApi.getRender(t.workspaceId, t.renderId);
            } catch {
              return; // transient: read again next round
            }
            if (!render?.status) return;
            report(t, render);
            if (ACTIVE_RENDER_STATUSES.includes(render.status)) return;
            untrackUgcRender(t.renderId);
            if (render.status === "succeeded") {
              emitAppEvent("assets:changed");
              toast.success("Your video ad is ready", {
                action: {
                  label: "Open",
                  onClick: () => emitAppEvent("open:ugc-studio", { projectId: t.projectId }),
                },
              });
            } else if (render.status === "failed") {
              toast.error("Your video ad didn't finish", {
                description: render.errorMessage ?? undefined,
                action: {
                  label: "Open",
                  onClick: () => emitAppEvent("open:ugc-studio", { projectId: t.projectId }),
                },
              });
            }
          }),
        );
      } finally {
        running = false;
        window.clearTimeout(timer);
        if (!stopped && trackedUgcRenders().length) timer = window.setTimeout(tick, POLL_MS);
      }
    };

    const off = onUgcRenderTracked((t) => {
      report(t, null);
      window.clearTimeout(timer);
      timer = window.setTimeout(tick, 2500);
    });
    if (trackedUgcRenders().length) void tick();
    return () => {
      stopped = true;
      off();
      window.clearTimeout(timer);
    };
  }, []);
  return null;
}
