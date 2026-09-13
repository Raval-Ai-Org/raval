"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type TargetAndTransition } from "framer-motion";
import {
  Brain,
  Camera,
  Check,
  Compass,
  LayoutTemplate,
  ListTree,
  Minus,
  Palette,
  PenLine,
  Save,
  Sparkles,
  Type,
  X,
  type LucideIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { PLATFORMS } from "@/lib/social-platforms";
import { RATIOS } from "@/lib/studio/aspect";
import { readBrandPayload } from "@/lib/studio/client";
import { STUDIO_FORMATS, type StageId, type StudioType } from "@/lib/studio/formats";
import { GOALS } from "@/lib/studio/jobs";
import type { StudioSession } from "@/lib/studio/session-store";
import { getTemplate, type StudioTemplate } from "@/lib/studio/templates";
import { PreviewSkeleton } from "./previews/PreviewSkeleton";
import { formatElapsed, PlatformStack, TypeGlyph, useElapsed } from "./studio-ui";

/** Typical seconds per format — paces the progress bar, never shown as a promise. */
const TYPICAL_SECONDS: Record<StudioType, number> = {
  social: 20,
  carousel: 30,
  image: 50,
  ad: 60,
  video: 140,
  script: 20,
  article: 45,
};

const STAGE_ICON: Record<StageId, LucideIcon> = {
  context: Brain,
  angle: Compass,
  outline: ListTree,
  writing: PenLine,
  brief: Palette,
  captions: Type,
  render: Camera,
  save: Save,
  polish: Sparkles,
};

/** Each stage's icon acts out what it does while it's the current stage. */
const STAGE_MOTION: Record<StageId, { animate: TargetAndTransition; duration: number }> = {
  context: { animate: { scale: [1, 1.2, 1] }, duration: 1.6 },
  angle: { animate: { rotate: [0, 30, -20, 0] }, duration: 2.2 },
  outline: { animate: { y: [0, -1.5, 0] }, duration: 1.2 },
  writing: { animate: { x: [0, 1.5, -1, 0], rotate: [-8, 6, -8] }, duration: 1.1 },
  brief: { animate: { rotate: [0, -14, 14, 0] }, duration: 2 },
  captions: { animate: { scale: [1, 1.15, 1] }, duration: 1.3 },
  render: { animate: { scale: [1, 0.8, 1] }, duration: 1.4 },
  save: { animate: { y: [0, 2.5, 0] }, duration: 1.2 },
  polish: { animate: { rotate: [0, 180], scale: [1, 1.18, 1] }, duration: 2.4 },
};

const CANVAS_CAPTION: Record<StageId, string> = {
  context: "Gathering brand signals",
  angle: "Choosing the angle",
  outline: "Laying out the structure",
  writing: "Writing the draft",
  brief: "Composing the shot",
  captions: "Matching the captions",
  render: "Developing the visual",
  save: "Saving to your Library",
  polish: "Final polish",
};

function listPlatforms(session: StudioSession): string {
  const names = session.controls.platforms.map((p) => PLATFORMS[p].label);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** One honest sentence about what the current stage is actually doing. */
export function stageNarration(
  id: StageId | undefined,
  session: StudioSession,
  brandName?: string,
) {
  const c = session.controls;
  const ratio = c.ratio ? `${RATIOS[c.ratio].label.toLowerCase()} ${c.ratio}` : "";
  const goal = GOALS.find((g) => g.id === session.goal)?.label.toLowerCase();
  const template = getTemplate(session.template);
  switch (id) {
    case "context":
      return brandName
        ? `Pulling ${brandName}'s voice, audience and recent posts so nothing sounds generic.`
        : "Reading your workspace and recent posts so nothing sounds generic.";
    case "angle":
      return session.type === "script"
        ? "Testing openings until one earns the first two seconds."
        : session.type === "ad"
          ? "Picking distinct angles worth testing against each other."
          : `Weighing angles against your ${goal ? `${goal} ` : ""}goal and what you've posted lately.`;
    case "outline":
      return template
        ? `Shaping it as ${template.label.toLowerCase()}: ${template.beats.join(" → ")}.`
        : session.type === "carousel"
          ? `Mapping ${c.slideCount ?? 6} slides: a hook, the value, then the call to action.`
          : "Structuring the argument into sections and key takeaways.";
    case "writing":
      if (session.type === "article")
        return `Writing the full piece — ${{ short: "about 600", standard: "about 1,100", long: "about 1,800" }[c.length ?? "standard"]} words.`;
      if (session.type === "script")
        return `Writing beats timed to a ${c.durationSec ?? 30}-second runtime.`;
      if (session.type === "carousel")
        return "Writing each slide and the caption that carries them.";
      if (session.type === "ad")
        return "Writing primary text, headlines and CTAs for each variant.";
      return c.platforms.length > 1
        ? `Writing a native version for ${listPlatforms(session)}.`
        : `Writing for ${listPlatforms(session) || "your feed"}.`;
    case "brief":
      return session.type === "video"
        ? "Planning shots, motion and pacing from your brief."
        : "Turning your brief into art direction: subject, light, composition.";
    case "captions":
      return `Writing captions that match the ${session.type === "video" ? "footage" : "visual"}.`;
    case "render":
      return session.type === "video"
        ? `Rendering ${c.durationSec ?? 6}s of ${c.videoResolution?.toLowerCase() ?? "720p"} video${ratio ? `, ${ratio}` : ""}. This is the long part.`
        : `Rendering a ${ratio || "sized"} visual in your brand's look.`;
    case "save":
      return "Saving the file to your Library so it's ready to post.";
    case "polish":
      return session.type === "carousel"
        ? "Laying out the slides in your brand style."
        : session.type === "article"
          ? "Editing for clarity, flow and scannable structure."
          : session.type === "script"
            ? "Trimming lines until everything fits the runtime."
            : "Checking character limits and where each platform folds the text.";
    default:
      return "Getting started.";
  }
}

/**
 * Generation as a visible creative process. On the left, the plan: where
 * Mellox is, what it's doing right now, what it has decided so far, and
 * what's next. On the right, the result taking shape stage by stage.
 *
 * This whole view re-renders every second (the timer), so every swap in it
 * is enter-only — an exit animation interrupted by a re-render can strand.
 */
export function GenerationProgress({
  session,
  onCancel,
  onMinimize,
  cancelling,
}: {
  session: StudioSession;
  onCancel: () => void;
  onMinimize: () => void;
  cancelling?: boolean;
}) {
  const format = STUDIO_FORMATS[session.type];
  const reduce = useReducedMotion();
  const job = session.job;
  const stages = format.stages;
  const stageIndex = Math.max(
    0,
    stages.findIndex((s) => s.id === job?.stage),
  );
  const stage = stages[stageIndex];
  const startedAt = job ? Date.parse(job.created_at) : session.updatedAt;
  const elapsed = useElapsed(startedAt);
  const brandName = useMemo(() => {
    const b = readBrandPayload(session.workspaceId);
    return typeof b?.brandName === "string" && b.brandName.trim() ? b.brandName.trim() : undefined;
  }, [session.workspaceId]);
  const template = getTemplate(session.template);
  const [confirmCancel, setConfirmCancel] = useState(false);
  useEffect(() => {
    if (!confirmCancel) return;
    const t = window.setTimeout(() => setConfirmCancel(false), 5000);
    return () => window.clearTimeout(t);
  }, [confirmCancel]);

  const typical = TYPICAL_SECONDS[session.type];
  const perStage = typical / stages.length;
  const slow = elapsed > typical * 2 && !(session.type === "video" && stage?.id === "render");
  const starting = !job;
  const CaptionIcon = stage ? STAGE_ICON[stage.id] : Sparkles;

  return (
    <div
      className={`studio-tone-${session.type} flex h-full min-h-0 flex-col @3xl/composer:grid @3xl/composer:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]`}
    >
      {/* ── The plan ── */}
      <div className="order-2 flex min-h-0 flex-col px-5 pb-5 pt-5 @3xl/composer:order-none @3xl/composer:overflow-y-auto @3xl/composer:px-8 @3xl/composer:pb-6 @3xl/composer:pt-8">
        <div className="flex items-center justify-between gap-3">
          <p className="ui-eyebrow">
            <span className="relative flex size-1.5">
              {!reduce ? (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-50" />
              ) : null}
              <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
            </span>
            {starting ? "Starting" : `Creating your ${format.noun}`}
          </p>
          <span
            className="font-mono text-xs tabular-nums text-muted-foreground"
            aria-label={`Elapsed ${elapsed} seconds`}
          >
            {formatElapsed(elapsed)}
          </span>
        </div>

        <div className="mt-3 min-h-[5.5rem]" aria-live="polite">
          <div key={stage?.id ?? "start"} className="studio-enter-blur">
            <h2 className="text-balance text-[1.375rem] font-semibold leading-tight tracking-tight text-foreground">
              {starting ? "Warming up" : (stage?.label ?? "Getting started")}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {starting
                ? "Sending your brief and settings to Mellox."
                : stageNarration(stage?.id, session, brandName)}
            </p>
          </div>
        </div>

        {/* Segmented progress: done stages fill, the current one advances at a typical pace. */}
        <div
          className="mt-5 flex gap-1"
          role="progressbar"
          aria-label="Generation progress"
          aria-valuemin={0}
          aria-valuemax={stages.length}
          aria-valuenow={stageIndex}
          aria-valuetext={stage?.label}
        >
          {stages.map((s, i) => (
            <span
              key={s.id}
              className="relative h-1 flex-1 overflow-hidden rounded-full bg-foreground/[0.08]"
            >
              {i < stageIndex ? (
                <motion.span
                  className="absolute inset-0 origin-left rounded-full bg-primary"
                  initial={reduce ? false : { scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: duration.slow, ease: ease.emphasized }}
                />
              ) : i === stageIndex && !starting ? (
                <motion.span
                  key={s.id}
                  className="studio-progress-fill absolute inset-y-0 left-0 rounded-full"
                  initial={{ width: "4%" }}
                  animate={{ width: "88%" }}
                  transition={{ duration: Math.max(4, perStage * 1.6), ease: [0.1, 0.6, 0.3, 1] }}
                />
              ) : null}
            </span>
          ))}
        </div>

        <ol className="relative mt-6" aria-label="Stages">
          {stages.map((s, i) => {
            const state =
              i < stageIndex ? "done" : i === stageIndex && !starting ? "current" : "todo";
            const last = i === stages.length - 1;
            const Icon = STAGE_ICON[s.id];
            const act = STAGE_MOTION[s.id];
            return (
              <li
                key={s.id}
                className="relative flex items-center gap-3 pb-3.5 last:pb-0"
                aria-current={state === "current" ? "step" : undefined}
              >
                {!last ? (
                  <span aria-hidden className="absolute bottom-0 left-[13px] top-7 w-px bg-border">
                    <motion.span
                      className="absolute inset-x-0 top-0 origin-top bg-primary"
                      initial={false}
                      animate={{ height: state === "done" ? "100%" : "0%" }}
                      transition={{ duration: duration.xslow, ease: ease.emphasized }}
                    />
                  </span>
                ) : null}
                <span
                  className={cn(
                    "relative grid size-[27px] shrink-0 place-items-center rounded-full transition-colors duration-[--motion-duration-slow]",
                    state === "done" && "bg-primary text-primary-foreground",
                    state === "current" &&
                      "studio-ring bg-[hsl(var(--tone)/0.14)] text-[hsl(var(--tone))] ring-1 ring-[hsl(var(--tone)/0.3)]",
                    state === "todo" && "bg-surface-3 text-muted-foreground/50 ring-1 ring-border",
                  )}
                >
                  {state === "done" ? (
                    <motion.span
                      initial={reduce ? false : { scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: duration.medium, ease: ease.emphasized }}
                    >
                      <Check className="size-3.5" strokeWidth={3} />
                    </motion.span>
                  ) : state === "current" && !reduce ? (
                    <motion.span
                      key={`act-${s.id}`}
                      className="grid place-items-center"
                      animate={act.animate}
                      transition={{ duration: act.duration, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <Icon className="size-3.5" />
                    </motion.span>
                  ) : (
                    <Icon className="size-3.5" />
                  )}
                </span>
                <span
                  className={cn(
                    "text-sm leading-6 transition-colors duration-[--motion-duration-slow]",
                    state === "current" && "font-medium text-foreground",
                    state === "done" && "text-muted-foreground",
                    state === "todo" && "text-muted-foreground/60",
                  )}
                >
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>

        <GenerationFeed
          session={session}
          stageIndex={starting ? -1 : stageIndex}
          brandName={brandName}
          template={template}
        />

        <AnimatePresence>
          {slow ? (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="mt-5 text-xs leading-relaxed text-muted-foreground"
            >
              Taking longer than usual — it's still working. Keep working elsewhere; you'll be told
              when it's ready.
            </motion.p>
          ) : null}
        </AnimatePresence>

        {session.brief ? (
          <figure className="mt-7 border-l-2 border-primary/50 pl-3.5">
            <figcaption className="ui-eyebrow">Your brief</figcaption>
            <blockquote className="mt-2 line-clamp-3 text-sm leading-relaxed text-foreground/85">
              {session.brief}
            </blockquote>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <TypeGlyph type={session.type} size="sm" className="size-5 [&_svg]:size-3" />
              {template ? template.label : format.label}
              {session.controls.platforms.length ? (
                <>
                  <span aria-hidden>·</span>
                  <PlatformStack platforms={session.controls.platforms} size={18} />
                </>
              ) : null}
              {session.controls.ratio && format.ratios.length ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">{session.controls.ratio}</span>
                </>
              ) : null}
            </div>
          </figure>
        ) : null}

        <div className="mt-auto pt-7">
          {confirmCancel ? (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: duration.base }}
              className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-2 pl-3.5"
            >
              <span className="mr-auto text-sm text-foreground">Stop and discard this run?</span>
              <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(false)}>
                Keep going
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onCancel}
                loading={cancelling}
                className="text-danger"
              >
                Stop
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key="actions"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: duration.base }}
              className="flex flex-wrap items-center gap-2"
            >
              <Button variant="outline" size="sm" onClick={onMinimize}>
                <Minus />
                Keep working
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setConfirmCancel(true)}
                disabled={cancelling}
              >
                <X />
                Cancel
              </Button>
              <span className="hidden text-xs text-muted-foreground @7xl/composer:inline">
                Lands in Needs Approval
              </span>
            </motion.div>
          )}
        </div>
      </div>

      {/* ── The result taking shape ── */}
      <div className="order-1 p-3 @3xl/composer:order-none @3xl/composer:p-4 @3xl/composer:pl-0">
        <div className="studio-canvas studio-ring studio-ring-slow relative flex h-[380px] items-center justify-center overflow-hidden rounded-2xl ring-1 ring-border/70 @3xl/composer:h-full @3xl/composer:min-h-[420px]">
          <div aria-hidden className="studio-aurora" />
          <div className="relative flex max-h-full w-full origin-center scale-[0.7] items-center justify-center overflow-visible px-6 pb-6 pt-12 @3xl/composer:scale-100">
            <PreviewSkeleton
              session={session}
              stageIndex={starting ? 0 : stageIndex}
              template={template}
            />
          </div>
          <motion.p
            key={stage?.id ?? "start"}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: duration.medium, ease: ease.emphasized }}
            className="absolute bottom-3 left-1/2 hidden -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-3/85 px-3 py-1 text-[11px] text-muted-foreground shadow-1 ring-1 ring-border/60 backdrop-blur @3xl/composer:inline-flex"
          >
            <CaptionIcon className="size-3 text-[hsl(var(--tone))]" />
            <span className="font-medium text-foreground">
              {stage
                ? stage.id === "render" && session.type === "video"
                  ? "Rendering frames"
                  : CANVAS_CAPTION[stage.id]
                : "Warming up"}
            </span>
            <span aria-hidden>·</span>
            {stageIndex + 1} of {stages.length}
          </motion.p>
        </div>
      </div>
    </div>
  );
}

type Note = { key: string; icon: LucideIcon; label: string; text?: string };

/**
 * "Mellox's notes": what has actually been decided so far, from the job's
 * real output — never invented. The next decision shows as typing.
 */
function GenerationFeed({
  session,
  stageIndex,
  brandName,
  template,
}: {
  session: StudioSession;
  stageIndex: number;
  brandName?: string;
  template: StudioTemplate | null;
}) {
  const reduce = useReducedMotion();
  const format = STUDIO_FORMATS[session.type];
  const out = session.job?.output ?? {};
  const ids = format.stages.map((s) => s.id);
  const current = stageIndex >= 0 ? ids[stageIndex] : undefined;
  const c = session.controls;

  const notes: Note[] = [
    {
      key: "brand",
      icon: Brain,
      label: brandName ? `Using ${brandName}'s voice` : "Reading your workspace",
    },
  ];
  if (template)
    notes.push({
      key: "template",
      icon: LayoutTemplate,
      label: `Template · ${template.label}`,
      text: template.beats.join(" → "),
    });
  if (out.angle)
    notes.push({ key: "angle", icon: Compass, label: "Angle chosen", text: out.angle });
  const title = out.article?.title ?? out.script?.title ?? out.title;
  if (title) notes.push({ key: "title", icon: PenLine, label: "Headline", text: `“${title}”` });
  const hook =
    out.script?.hook ??
    out.slides?.[0]?.heading ??
    out.ads?.[0]?.primaryText ??
    out.variants?.[0]?.body.split("\n").find((l) => l.trim());
  if (hook)
    notes.push({
      key: "hook",
      icon: Sparkles,
      label: session.type === "carousel" ? "First slide" : "Opening line",
      text: `“${hook}”`,
    });
  const concept = out.concept ?? out.visualConcept;
  if (concept)
    notes.push({ key: "concept", icon: Palette, label: "Visual concept", text: concept });
  if (current === "render") {
    const where = c.platforms[0] ? ` for ${PLATFORMS[c.platforms[0]].label}` : "";
    notes.push({
      key: "render",
      icon: Camera,
      label: `Rendering ${c.ratio ?? format.ratios[0] ?? ""}${where}`.trim(),
    });
  }

  const next =
    stageIndex < 0
      ? "Starting up"
      : !out.angle && ids.includes("angle")
        ? "Choosing an angle"
        : !title && !hook
          ? session.type === "image" || session.type === "video"
            ? "Planning the visual and captions"
            : "Drafting the copy"
          : format.media !== "none" && !concept && ids.includes("render") && current !== "render"
            ? "Composing the visual"
            : "Polishing the details";

  return (
    <section data-no-rhythm aria-label="What Mellox has decided" className="mt-7">
      <h3 className="ui-eyebrow mb-3">Mellox's notes</h3>
      <ul className="space-y-2.5">
        {notes.map((n) => (
          <motion.li
            key={n.key}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: duration.slow, ease: ease.emphasized }}
            className="flex gap-2.5"
          >
            <span className="studio-glyph mt-px grid size-6 shrink-0 place-items-center rounded-lg">
              <n.icon className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1 text-xs leading-5">
              <span className="block font-medium text-foreground">{n.label}</span>
              {n.text ? (
                <span
                  className="studio-reveal line-clamp-2 block text-muted-foreground"
                  style={
                    {
                      "--reveal-duration": `${Math.min(1.6, 0.4 + n.text.length * 0.012)}s`,
                      animationDelay: "150ms",
                    } as React.CSSProperties
                  }
                >
                  {n.text}
                </span>
              ) : null}
            </span>
          </motion.li>
        ))}
        <motion.li
          key={`next-${next}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: duration.base }}
          className="flex items-center gap-2.5 text-xs text-muted-foreground"
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-surface-2">
            <span className="flex gap-[3px]">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="size-1 rounded-full bg-muted-foreground"
                  animate={reduce ? undefined : { opacity: [0.25, 1, 0.25], y: [0, -1.5, 0] }}
                  transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </span>
          </span>
          {next}…
        </motion.li>
      </ul>
    </section>
  );
}
