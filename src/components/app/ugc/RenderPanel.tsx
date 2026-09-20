"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import {
  BookOpen,
  Check,
  Copy,
  Download,
  Loader2,
  Megaphone,
  Pencil,
  RefreshCw,
  Video,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/empty-state";
import { supabase } from "@/integrations/supabase/client";
import { emitAppEvent } from "@/lib/app-events";
import { ugcApi, UgcApiError } from "@/lib/ugc/client";
import { ACTIVE_RENDER_STATUSES, type RenderView, type Script } from "@/lib/ugc/schemas";
import { cn } from "@/lib/utils";
import { formatUsd, motionPreset, Panel, RenderStatusChip } from "./ugc-ui";

const STAGES = [
  { id: "send", label: "Sending to the video model", statuses: ["queued", "submitting"] },
  { id: "render", label: "Filming your creator", statuses: ["processing"] },
  { id: "save", label: "Saving to your Library", statuses: ["persisting"] },
  { id: "done", label: "Ready", statuses: ["succeeded"] },
] as const;

const TYPICAL_RENDER_SECONDS = 90;

/** Keep a render fresh: realtime row changes plus a polling fallback that also advances it server-side. */
export function useRenderProgress(
  workspaceId: string,
  initial: RenderView | null,
  onSettled?: (render: RenderView) => void,
) {
  const [render, setRender] = useState<RenderView | null>(initial);
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);
  const id = render?.id ?? null;
  const active = render ? ACTIVE_RENDER_STATUSES.includes(render.status) : false;

  useEffect(() => {
    if (!id || !active) return;
    let cancelled = false;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const next = await ugcApi.getRender(workspaceId, id);
        if (cancelled) return;
        setRender(next);
        if (!ACTIVE_RENDER_STATUSES.includes(next.status)) {
          settledRef.current?.(next);
          return;
        }
      } catch {
        /* transient — keep polling */
      }
      if (!cancelled) timer = window.setTimeout(refresh, 5000);
    };
    timer = window.setTimeout(refresh, 2500);
    const channel = supabase
      .channel(`ugc-render-${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "ugc_renders", filter: `id=eq.${id}` },
        () => {
          window.clearTimeout(timer);
          void refresh();
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [workspaceId, id, active]);

  return [render, setRender] as const;
}

function useElapsed(since: string | null, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  return since ? Math.max(0, Math.round((now - Date.parse(since)) / 1000)) : 0;
}

function ratioClass(ratio: string) {
  switch (ratio) {
    case "9:16":
      return "aspect-[9/16] max-h-[62dvh]";
    case "16:9":
      return "aspect-video";
    case "1:1":
      return "aspect-square max-h-[62dvh]";
    case "3:4":
      return "aspect-[3/4] max-h-[62dvh]";
    default:
      return "aspect-[4/3]";
  }
}

export function RenderPanel({
  workspaceId,
  render: initialRender,
  script,
  history,
  onSettled,
  onRegenerate,
  onEditSettings,
  onSelectRender,
  regenerating,
}: {
  workspaceId: string;
  render: RenderView;
  script: Script | null;
  history: RenderView[];
  onSettled: (render: RenderView) => void;
  onRegenerate: () => void;
  onEditSettings: () => void;
  onSelectRender: (render: RenderView) => void;
  regenerating: boolean;
}) {
  const reduce = useReducedMotion();
  const [render, setRender] = useRenderProgress(workspaceId, initialRender, onSettled);
  const [busy, setBusy] = useState<string | null>(null);
  if (!render) return null;
  const active = ACTIVE_RENDER_STATUSES.includes(render.status);
  const stageIndex = STAGES.findIndex((s) =>
    (s.statuses as readonly string[]).includes(render.status),
  );

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (error) {
      toast.error(error instanceof UgcApiError ? error.message : "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Panel className="flex flex-col items-center justify-center gap-4 p-4 sm:p-6">
        <AnimatePresence mode="wait">
          {render.status === "succeeded" && render.videoUrl ? (
            <motion.div
              key="video"
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, filter: "blur(8px)" }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, filter: "blur(0px)" }}
              transition={motionPreset.slow}
              className={cn(
                "relative w-full max-w-sm overflow-hidden rounded-2xl bg-black shadow-4 ring-1 ring-border",
                ratioClass(render.aspectRatio),
                render.aspectRatio === "16:9" && "max-w-2xl",
              )}
            >
              <video
                key={render.videoUrl}
                src={render.videoUrl}
                controls
                autoPlay
                playsInline
                loop
                className="size-full object-contain"
              />
            </motion.div>
          ) : active ? (
            <RenderingState key="rendering" render={render} stageIndex={stageIndex} />
          ) : (
            <motion.div
              key="failed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="w-full max-w-md"
            >
              <ErrorState
                title={
                  render.status === "cancelled" ? "Render cancelled" : "This render didn't work"
                }
                description={render.errorMessage ?? "The video couldn't be finished."}
                detail={render.allowanceReturned ? "Your video credit was returned." : undefined}
                onRetry={onRegenerate}
                retryLabel="Try again"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </Panel>

      <div className="space-y-3">
        <Panel className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="min-w-0 truncate text-sm font-semibold">{render.modelName}</span>
            <RenderStatusChip status={render.status} className="shrink-0" />
          </div>
          <p className="flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
            {render.durationSec}s · {render.aspectRatio} · {render.resolution}
            {render.status === "succeeded" && render.actualCostUsd != null
              ? ` · ${formatUsd(render.actualCostUsd)}`
              : ""}
          </p>
          {render.hook ? <p className="text-[12.5px] leading-snug">“{render.hook}”</p> : null}

          {render.status === "succeeded" ? (
            <div className="grid gap-2">
              <Button
                loading={busy === "download"}
                onClick={() =>
                  act("download", async () => {
                    const { url } = await ugcApi.download(workspaceId, render.id);
                    const a = document.createElement("a");
                    a.href = url;
                    a.rel = "noopener";
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                  })
                }
              >
                <Download aria-hidden /> Download MP4
              </Button>
              <Button
                variant="outline"
                loading={busy === "post"}
                onClick={() =>
                  act("post", async () => {
                    const { contentItemId } = await ugcApi.postDraft(workspaceId, render.id);
                    emitAppEvent("content:changed");
                    toast.success("Draft post created with this video");
                    emitAppEvent("open:content-item", { id: contentItemId });
                  })
                }
              >
                <Megaphone aria-hidden /> Use in a post
              </Button>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!script?.postCaption && !script?.hook}
                  onClick={() =>
                    act("copy", async () => {
                      const text = [
                        script?.postCaption || script?.hook,
                        script?.hashtags.map((h) => `#${h}`).join(" "),
                      ]
                        .filter(Boolean)
                        .join("\n\n");
                      await navigator.clipboard.writeText(text);
                      toast.success("Caption copied");
                    })
                  }
                >
                  <Copy aria-hidden /> Caption
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => emitAppEvent("open:library", { tab: "media" })}
                >
                  <BookOpen aria-hidden /> Library
                </Button>
              </div>
            </div>
          ) : null}

          {active && (render.status === "queued" || render.status === "submitting") ? (
            <Button
              variant="ghost"
              size="sm"
              loading={busy === "cancel"}
              onClick={() =>
                act("cancel", async () => {
                  setRender(await ugcApi.cancelRender(workspaceId, render.id));
                })
              }
            >
              Cancel render
            </Button>
          ) : null}

          {!active ? (
            <div className="grid gap-2 border-t border-border/60 pt-3 sm:grid-cols-2">
              <Button variant="outline" size="sm" onClick={onRegenerate} loading={regenerating}>
                {regenerating ? null : <RefreshCw aria-hidden />} Regenerate
              </Button>
              <Button variant="outline" size="sm" onClick={onEditSettings}>
                <Pencil aria-hidden /> Edit & redo
              </Button>
            </div>
          ) : null}
        </Panel>

        {history.length > 1 ? (
          <Panel className="space-y-2">
            <span className="text-xs font-medium">Renders for this ad</span>
            <ul className="space-y-1">
              {history.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onSelectRender(r)}
                    className={cn(
                      "flex min-w-0 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface-3",
                      r.id === render.id && "bg-surface-3",
                    )}
                  >
                    <Video className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      {r.modelName} · {r.durationSec}s
                    </span>
                    <RenderStatusChip status={r.status} className="shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

function RenderingState({ render, stageIndex }: { render: RenderView; stageIndex: number }) {
  const reduce = useReducedMotion();
  const elapsed = useElapsed(render.submittedAt ?? render.createdAt, true);
  const pct =
    render.status === "processing"
      ? Math.min(92, 20 + (elapsed / TYPICAL_RENDER_SECONDS) * 70)
      : render.status === "persisting"
        ? 95
        : 8;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={motionPreset.base}
      className="flex w-full max-w-sm flex-col items-center gap-5 py-6"
      aria-live="polite"
    >
      <div
        className={cn(
          "relative grid w-40 place-items-center overflow-hidden rounded-2xl bg-surface-3 ring-1 ring-border",
          ratioClass(render.aspectRatio),
        )}
      >
        {!reduce ? (
          <motion.div
            aria-hidden
            className="absolute inset-x-0 h-1/3 bg-gradient-to-b from-transparent via-primary/25 to-transparent"
            initial={{ top: "-33%" }}
            animate={{ top: "100%" }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
          />
        ) : null}
        <Video className="relative size-7 text-primary" aria-hidden />
      </div>
      <div className="w-full space-y-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
          <motion.div
            className="h-full rounded-full bg-primary"
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        </div>
        <ol className="space-y-1.5">
          {STAGES.slice(0, 3).map((stage, i) => (
            <li
              key={stage.id}
              className={cn(
                "flex items-center gap-2 text-sm",
                i > stageIndex && "text-muted-foreground",
              )}
            >
              {i < stageIndex ? (
                <Check className="size-4 text-primary" aria-hidden />
              ) : i === stageIndex ? (
                <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
              ) : (
                <span className="size-4 rounded-full border border-border" aria-hidden />
              )}
              {stage.label}
            </li>
          ))}
        </ol>
        <p className="text-center text-xs text-muted-foreground tabular-nums">
          {elapsed}s elapsed · usually 1–3 minutes. You can close this — the video will be in your
          Library.
        </p>
      </div>
    </motion.div>
  );
}
