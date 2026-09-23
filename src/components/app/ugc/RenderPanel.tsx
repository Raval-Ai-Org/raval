"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import {
  AlertTriangle,
  BookOpen,
  Check,
  Copy,
  Download,
  Megaphone,
  Pencil,
  RefreshCw,
  Save,
  Send,
  Video,
  type LucideIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { emitAppEvent } from "@/lib/app-events";
import { ugcApi, UgcApiError } from "@/lib/ugc/client";
import { ACTIVE_RENDER_STATUSES, type RenderView, type Script } from "@/lib/ugc/schemas";
import { cn } from "@/lib/utils";
import {
  CreatorSilhouette,
  formatUsd,
  motionPreset,
  Panel,
  PhoneFrame,
  RenderStatusChip,
  SectionLabel,
} from "./ugc-ui";

const STAGES: { id: string; label: string; icon: LucideIcon; statuses: readonly string[] }[] = [
  { id: "send", label: "Sending", icon: Send, statuses: ["queued", "submitting"] },
  { id: "render", label: "Filming", icon: Video, statuses: ["processing"] },
  { id: "save", label: "Saving", icon: Save, statuses: ["persisting"] },
  { id: "done", label: "Ready", icon: Check, statuses: ["succeeded"] },
];

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

function frameWidth(ratio: string) {
  switch (ratio) {
    case "16:9":
    case "4:3":
      return "w-full max-w-xl";
    case "1:1":
      return "w-full max-w-sm";
    default:
      return "w-full max-w-[280px]";
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
  const succeeded = render.status === "succeeded" && Boolean(render.videoUrl);
  const stageIndex = STAGES.findIndex((s) => s.statuses.includes(render.status));

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
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex flex-col items-center gap-5">
        <div className={frameWidth(render.aspectRatio)}>
          <PhoneFrame ratio={render.aspectRatio}>
            <AnimatePresence mode="wait">
              {succeeded ? (
                <motion.div
                  key="video"
                  initial={
                    reduce ? { opacity: 0 } : { opacity: 0, scale: 1.06, filter: "blur(10px)" }
                  }
                  animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, filter: "blur(0px)" }}
                  transition={motionPreset.slow}
                  className="absolute inset-0"
                >
                  <video
                    key={render.videoUrl}
                    src={render.videoUrl ?? undefined}
                    controls
                    autoPlay
                    playsInline
                    loop
                    className="size-full! bg-black object-contain"
                  />
                </motion.div>
              ) : active ? (
                <RenderingScreen key="rendering" render={render} />
              ) : (
                <motion.div
                  key="failed"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-5 text-center"
                >
                  <span className="grid size-12 place-items-center rounded-full bg-danger/20 text-danger">
                    <AlertTriangle className="size-6" aria-hidden />
                  </span>
                  <p className="text-sm font-semibold">
                    {render.status === "cancelled" ? "Cancelled" : "Didn't work"}
                  </p>
                  <p className="line-clamp-4 text-[11.5px] text-white/65">
                    {render.errorMessage ?? "The video couldn't be finished."}
                  </p>
                  {render.allowanceReturned ? (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] text-white/80">
                      Credit returned
                    </span>
                  ) : null}
                  <Button size="sm" onClick={onRegenerate} loading={regenerating}>
                    {regenerating ? null : <RefreshCw aria-hidden />} Try again
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </PhoneFrame>
        </div>

        {active ? <StageTrack stageIndex={stageIndex} /> : null}
      </div>

      <div className="space-y-4">
        <Panel className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <RenderStatusChip status={render.status} />
            <span className="flex flex-wrap justify-end gap-1 text-[11px] tabular-nums text-muted-foreground">
              {[
                `${render.durationSec}s`,
                render.aspectRatio,
                render.resolution,
                render.status === "succeeded" && render.actualCostUsd != null
                  ? formatUsd(render.actualCostUsd)
                  : null,
              ]
                .filter(Boolean)
                .map((t) => (
                  <span key={t} className="rounded-full bg-[var(--ds-well-bg)] px-2 py-0.5">
                    {t}
                  </span>
                ))}
            </span>
          </div>
          {render.hook ? (
            <p className="text-[13px] font-medium leading-snug">“{render.hook}”</p>
          ) : null}

          {render.status === "succeeded" ? (
            <motion.div
              initial={reduce ? false : "hidden"}
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
              className="space-y-2"
            >
              <Button
                size="lg"
                className="w-full"
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
                <Download aria-hidden /> Download
              </Button>
              <div className="grid grid-cols-3 gap-2">
                <ActionTile
                  icon={Megaphone}
                  label="Post"
                  loading={busy === "post"}
                  onClick={() =>
                    act("post", async () => {
                      const { contentItemId } = await ugcApi.postDraft(workspaceId, render.id);
                      emitAppEvent("content:changed");
                      toast.success("Draft post created with this video");
                      emitAppEvent("open:content-item", { id: contentItemId });
                    })
                  }
                />
                <ActionTile
                  icon={Copy}
                  label="Caption"
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
                />
                <ActionTile
                  icon={BookOpen}
                  label="Library"
                  onClick={() => emitAppEvent("open:library", { tab: "media" })}
                />
              </div>
            </motion.div>
          ) : null}

          {active && (render.status === "queued" || render.status === "submitting") ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              loading={busy === "cancel"}
              onClick={() =>
                act("cancel", async () => {
                  setRender(await ugcApi.cancelRender(workspaceId, render.id));
                })
              }
            >
              Cancel
            </Button>
          ) : null}

          {!active ? (
            <div className="grid grid-cols-2 gap-2 border-t border-[var(--ds-tile-border)] pt-4">
              <Button variant="outline" size="sm" onClick={onRegenerate} loading={regenerating}>
                {regenerating ? null : <RefreshCw aria-hidden />} Again
              </Button>
              <Button variant="outline" size="sm" onClick={onEditSettings}>
                <Pencil aria-hidden /> Change
              </Button>
            </div>
          ) : null}
        </Panel>

        {history.length > 1 ? (
          <Panel className="space-y-3">
            <SectionLabel icon={Video}>Versions</SectionLabel>
            <ul className="grid grid-cols-4 gap-2">
              {history.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onSelectRender(r)}
                    aria-label={`${r.modelName} · ${r.durationSec}s`}
                    title={`${r.modelName} · ${r.durationSec}s`}
                    className={cn(
                      "relative block aspect-[9/16] w-full overflow-hidden rounded-xl bg-neutral-900 ring-2 transition",
                      r.id === render.id
                        ? "ring-primary"
                        : "ring-transparent hover:ring-primary/40",
                    )}
                  >
                    {r.videoUrl ? (
                      <video
                        src={r.videoUrl}
                        muted
                        playsInline
                        preload="metadata"
                        className="size-full! object-cover"
                      />
                    ) : (
                      <span className="absolute inset-x-2 bottom-0 top-4">
                        <CreatorSilhouette />
                      </span>
                    )}
                    <span
                      className={cn(
                        "absolute bottom-1 left-1/2 size-2 -translate-x-1/2 rounded-full",
                        r.status === "succeeded"
                          ? "bg-primary"
                          : ACTIVE_RENDER_STATUSES.includes(r.status)
                            ? "animate-pulse bg-white"
                            : "bg-danger",
                      )}
                      aria-hidden
                    />
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

function ActionTile({
  icon: Icon,
  label,
  onClick,
  loading,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <motion.button
      type="button"
      variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      disabled={disabled || loading}
      className="flex flex-col items-center gap-1.5 rounded-2xl bg-[var(--ds-well-bg)] px-2 py-3 text-[11.5px] font-medium transition-colors hover:bg-primary/15 disabled:opacity-50"
    >
      <span className="grid size-8 place-items-center rounded-full bg-background text-primary">
        {loading ? (
          <span className="size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        ) : (
          <Icon className="size-4" aria-hidden />
        )}
      </span>
      {label}
    </motion.button>
  );
}

/** Icon steps under the phone: sending → filming → saving. */
function StageTrack({ stageIndex }: { stageIndex: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {STAGES.slice(0, 3).map((stage, i) => {
        const done = i < stageIndex;
        const current = i === stageIndex;
        return (
          <li key={stage.id} className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                current
                  ? "bg-primary text-primary-foreground"
                  : done
                    ? "bg-primary/15 text-primary"
                    : "bg-[var(--ds-well-bg)] text-muted-foreground",
              )}
              aria-current={current ? "step" : undefined}
            >
              {done ? (
                <Check className="size-3.5" aria-hidden />
              ) : (
                <stage.icon className={cn("size-3.5", current && "animate-pulse")} aria-hidden />
              )}
              {stage.label}
            </span>
            {i < 2 ? <span className="h-px w-4 bg-[var(--ds-tile-border)]" aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Inside the phone while filming. A loading signal, so it keeps moving under reduced motion. */
function RenderingScreen({ render }: { render: RenderView }) {
  const elapsed = useElapsed(render.submittedAt ?? render.createdAt, true);
  const pct =
    render.status === "processing"
      ? Math.min(92, 20 + (elapsed / TYPICAL_RENDER_SECONDS) * 70)
      : render.status === "persisting"
        ? 95
        : 8;
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={motionPreset.base}
      className="absolute inset-0"
      aria-live="polite"
    >
      <motion.div
        aria-hidden
        className="absolute -inset-1/2 bg-[conic-gradient(from_0deg,transparent,hsl(var(--primary)/0.28),transparent_40%)]"
        animate={{ rotate: 360 }}
        transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
      />
      <div className="absolute inset-x-[20%] bottom-0 top-[35%] opacity-60">
        <CreatorSilhouette />
      </div>
      <motion.div
        aria-hidden
        className="absolute inset-x-0 h-1/3 bg-gradient-to-b from-transparent via-primary/25 to-transparent"
        initial={{ top: "-33%" }}
        animate={{ top: "100%" }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <div className="relative grid size-24 place-items-center">
          <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90">
            <circle
              cx="40"
              cy="40"
              r={r}
              fill="none"
              strokeWidth="5"
              stroke="rgb(255 255 255 / 0.12)"
            />
            <motion.circle
              cx="40"
              cy="40"
              r={r}
              fill="none"
              strokeWidth="5"
              strokeLinecap="round"
              stroke="hsl(var(--primary))"
              strokeDasharray={c}
              initial={false}
              animate={{ strokeDashoffset: c * (1 - pct / 100) }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </svg>
          <span className="text-lg font-semibold tabular-nums">{Math.round(pct)}%</span>
        </div>
        <span className="rounded-full bg-black/55 px-2.5 py-1 text-[11px] tabular-nums text-white/80 backdrop-blur">
          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} · ~1–3 min
        </span>
      </div>
      <p className="absolute inset-x-3 bottom-3 text-center text-[10.5px] text-white/60">
        Safe to close — it lands in your Library.
      </p>
    </motion.div>
  );
}
