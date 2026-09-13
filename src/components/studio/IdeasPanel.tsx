"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, RefreshCw, Sparkles, Wand2, X } from "@/components/icons";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { readBrandPayload, studioApi } from "@/lib/studio/client";
import { STUDIO_FORMATS, type StudioType } from "@/lib/studio/formats";
import { IDEA_SOURCE_LABEL, type StudioIdea } from "@/lib/studio/ideas";
import { TypeGlyph } from "./studio-ui";

type Dismissed = { id: string; title: string };

/** Each signal source borrows a format tone so ideas scan by why they exist. */
const SOURCE_TONE: Record<string, StudioType> = {
  trend: "image",
  season: "carousel",
  pillar: "social",
  competitor: "video",
  gap: "article",
  momentum: "ad",
};

function dismissedKey(workspaceId: string) {
  return `studio:ideas-dismissed:${workspaceId}`;
}

export function readDismissed(workspaceId: string): Dismissed[] {
  try {
    const raw = localStorage.getItem(dismissedKey(workspaceId));
    return raw ? (JSON.parse(raw) as Dismissed[]) : [];
  } catch {
    return [];
  }
}

function writeDismissed(workspaceId: string, list: Dismissed[]) {
  try {
    localStorage.setItem(dismissedKey(workspaceId), JSON.stringify(list.slice(-40)));
  } catch {
    /* ignore */
  }
}

/**
 * Signal-anchored ideas. With a `type` they're specific to that format; without
 * one (the start screen) they span formats. Each idea says why it's worth
 * making now; picking one fills the brief.
 */
export function IdeasPanel({
  workspaceId,
  type,
  onPick,
  onGenerate,
  selectedId,
  variant = "list",
  limit = 4,
  fixtureIdeas,
  title,
}: {
  workspaceId: string;
  type?: StudioType;
  onPick: (idea: StudioIdea) => void;
  /** Skip the brief: generate this idea straight away. */
  onGenerate?: (idea: StudioIdea) => void;
  selectedId?: string;
  variant?: "list" | "grid";
  limit?: number;
  /** Preview/testing: render these instead of calling the API. */
  fixtureIdeas?: StudioIdea[];
  /** Heading text; null hides it when the surrounding UI already names the list. */
  title?: string | null;
}) {
  const [ideas, setIdeas] = useState<StudioIdea[]>(fixtureIdeas ?? []);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    fixtureIdeas ? "ready" : "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef(0);

  const load = useCallback(
    async (refresh = false) => {
      if (fixtureIdeas) return;
      const id = ++request.current;
      if (refresh) setRefreshing(true);
      else setStatus("loading");
      setError(null);
      try {
        const dismissed = readDismissed(workspaceId);
        const res = await studioApi.ideas({
          workspaceId,
          type,
          brand: readBrandPayload(workspaceId),
          dismissed: dismissed.map((d) => d.title),
          refresh,
          limit,
        });
        if (id !== request.current) return;
        const hidden = new Set(dismissed.map((d) => d.id));
        setIdeas(res.ideas.filter((i) => !hidden.has(i.id)));
        setStatus("ready");
      } catch (e) {
        if (id !== request.current) return;
        setError(e instanceof Error ? e.message : "Couldn't load ideas");
        setStatus("error");
      } finally {
        if (id === request.current) setRefreshing(false);
      }
    },
    [workspaceId, type, limit, fixtureIdeas],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const dismiss = (idea: StudioIdea) => {
    writeDismissed(workspaceId, [
      ...readDismissed(workspaceId),
      { id: idea.id, title: idea.title },
    ]);
    setIdeas((list) => list.filter((i) => i.id !== idea.id));
  };

  const heading =
    title === null
      ? null
      : (title ?? (type ? `Ideas for ${STUDIO_FORMATS[type].noun}s` : "Suggested for you"));
  const grid = variant === "grid";

  return (
    <section
      data-no-rhythm
      aria-labelledby={heading === null ? undefined : "studio-ideas-heading"}
      aria-label={heading === null ? "Ideas" : undefined}
      aria-busy={status === "loading" || refreshing}
    >
      <div
        className={cn(
          "mb-2.5 flex items-center gap-2",
          heading === null ? "justify-end" : "justify-between",
        )}
      >
        {heading === null ? null : (
          <h3
            id="studio-ideas-heading"
            className="flex items-center gap-1.5 text-sm font-medium text-foreground"
          >
            <Sparkles className="size-4 text-primary" />
            {heading}
          </h3>
        )}
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing || status === "loading" || !!fixtureIdeas}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          Fresh ideas
        </button>
      </div>

      {status === "loading" ? (
        <ul
          className={cn(grid ? "grid gap-2 sm:grid-cols-2" : "space-y-2")}
          aria-label="Loading ideas"
        >
          {Array.from({ length: grid ? 4 : 3 }).map((_, k) => (
            <li
              key={k}
              className="relative h-[92px] overflow-hidden rounded-xl border border-border bg-surface-3"
            >
              <span className="studio-weave absolute inset-0" />
              <span className="absolute left-3 top-3 h-2.5 w-16 rounded-full bg-surface-2" />
              <span className="absolute left-3 top-8 h-3 w-4/5 rounded-full bg-surface-2" />
              <span className="absolute left-3 top-14 h-2.5 w-3/5 rounded-full bg-surface-2" />
            </li>
          ))}
        </ul>
      ) : status === "error" ? (
        <div className="rounded-xl border border-border bg-surface-3 px-3.5 py-3 text-sm text-muted-foreground">
          <p>Ideas aren't available right now. You can still write your own brief.</p>
          <p className="mt-0.5 text-xs">{error}</p>
          <button
            type="button"
            onClick={() => void load(false)}
            className="mt-2 text-xs font-medium text-foreground underline-offset-4 hover:underline"
          >
            Try again
          </button>
        </div>
      ) : ideas.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3.5 py-3 text-sm text-muted-foreground">
          You've covered the obvious ideas. Ask for fresh ones, or write your own brief.
        </p>
      ) : (
        <ul className={cn(grid ? "grid gap-2 sm:grid-cols-2" : "space-y-2")}>
          <AnimatePresence initial={false}>
            {ideas.map((idea, i) => {
              const selected = selectedId === idea.id;
              return (
                <motion.li
                  key={idea.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    transition: {
                      delay: i * 0.04,
                      duration: duration.medium,
                      ease: ease.emphasized,
                    },
                  }}
                  exit={{ opacity: 0, scale: 0.98, transition: { duration: duration.fast } }}
                  className="group relative h-full"
                >
                  <button
                    type="button"
                    onClick={() => onPick(idea)}
                    aria-pressed={selected}
                    className={cn(
                      "flex h-full w-full flex-col rounded-2xl border p-3.5 pr-10 text-left transition-[border-color,background-color,box-shadow,translate] duration-[--motion-duration-base] ease-[--motion-ease-emphasized]",
                      onGenerate && "pb-12",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55",
                      selected
                        ? "border-primary-border bg-primary-surface"
                        : "border-border/70 bg-surface-3 hover:-translate-y-0.5 hover:border-primary-border hover:shadow-[0_16px_34px_-20px_hsl(var(--primary)/0.55)]",
                    )}
                  >
                    <span className="flex flex-wrap items-center gap-1.5">
                      {!type || idea.type !== type ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground/80">
                          <TypeGlyph type={idea.type} size="sm" className="size-5 [&_svg]:size-3" />
                          {STUDIO_FORMATS[idea.type].label}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
                          SOURCE_TONE[idea.source]
                            ? `studio-tone-${SOURCE_TONE[idea.source]} bg-[hsl(var(--tone)/0.12)] text-[hsl(var(--tone))] ring-[hsl(var(--tone)/0.28)]`
                            : "bg-surface-2 text-muted-foreground ring-border",
                        )}
                      >
                        {IDEA_SOURCE_LABEL[idea.source]}
                      </span>
                    </span>
                    <span className="mt-1.5 block text-sm font-medium leading-snug text-foreground">
                      {idea.title}
                    </span>
                    {idea.why ? (
                      <span className="mt-1 block text-xs leading-snug text-muted-foreground">
                        {idea.why}
                      </span>
                    ) : null}
                    {onGenerate ? null : (
                      <span className="mt-auto flex items-center gap-1 pt-2 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        Use this idea <ArrowRight className="size-3.5" />
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => dismiss(idea)}
                    aria-label={`Dismiss idea: ${idea.title}`}
                    title="Not relevant"
                    className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-md text-muted-foreground opacity-0 transition hover:bg-surface-2 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                  {onGenerate ? (
                    <button
                      type="button"
                      onClick={() => onGenerate(idea)}
                      aria-label={`Generate: ${idea.title}`}
                      className="studio-cta absolute bottom-3 right-3 inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground transition-transform duration-[--motion-duration-fast] hover:scale-[1.04] active:scale-95"
                    >
                      <Wand2 className="size-3" />
                      Generate
                    </button>
                  ) : null}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
