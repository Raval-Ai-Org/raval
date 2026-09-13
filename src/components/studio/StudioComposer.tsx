"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { Maximize2, Minimize2 } from "lucide-react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clock,
  Inbox,
  LayoutTemplate,
  Minus,
  Sparkles,
  Wand2,
  X,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { rememberStudioType } from "@/hooks/use-studio";
import { emitAppEvent } from "@/lib/app-events";
import { cn } from "@/lib/utils";
import { duration, ease, spring } from "@/lib/motion";
import { isActiveJob } from "@/lib/studio/jobs";
import { RATIOS } from "@/lib/studio/aspect";
import { readBrandPayload } from "@/lib/studio/client";
import { STUDIO_FORMATS, type StudioType } from "@/lib/studio/formats";
import type { StudioIdea } from "@/lib/studio/ideas";
import { GOALS } from "@/lib/studio/jobs";
import { PLATFORMS } from "@/lib/social-platforms";
import { countBlanks, getTemplate } from "@/lib/studio/templates";
import {
  applyTemplate,
  backToBrief,
  backToStart,
  cancelSession,
  chooseType,
  closeSession,
  generate,
  minimizeSession,
  toggleMaximize,
  updateSession,
  useStudioStore,
  type StudioSession,
} from "@/lib/studio/session-store";
import { ControlsPanel } from "./ControlsPanel";
import { GenerationProgress } from "./GenerationProgress";
import { IdeasPanel } from "./IdeasPanel";
import { ReviewPanel, type ReviewRow } from "./ReviewPanel";
import { PreviewSkeleton } from "./previews/PreviewSkeleton";
import { StartStep } from "./StartStep";
import { BeatPills, TemplateGallery } from "./TemplateGallery";
import { ChipButton, TypeGlyph } from "./studio-ui";
import { TypePicker } from "./TypePicker";

const STEPS = [
  { id: "start", label: "Describe" },
  { id: "generating", label: "Create" },
  { id: "review", label: "Review" },
] as const;

/** Preview/testing data so the composer can render without a signed-in workspace. */
export type ComposerFixtures = { ideas?: StudioIdea[]; rows?: ReviewRow[]; distribution?: boolean };

/**
 * The Studio composer: one surface that carries a piece of work from format to
 * approval. It can be maximized, minimized to the dock while it keeps working,
 * and closed without losing anything.
 */
export function StudioComposer() {
  const session = useStudioStore(
    (s) => s.sessions.find((x) => x.id === s.activeId && x.window !== "minimized") ?? null,
  );
  const isMobile = useIsMobile();
  // Where the window goes when it leaves: into the dock (work continues) or away.
  const [exitTo, setExitTo] = useState<"dock" | "close">("close");
  const sessionId = session?.id;
  useEffect(() => {
    if (sessionId) setExitTo("close");
  }, [sessionId]);

  const toDock = (id: string) => {
    setExitTo("dock");
    minimizeSession(id);
  };

  return (
    <DialogPrimitive.Root
      open={!!session}
      onOpenChange={(v) => {
        if (v || !session) return;
        const keeps =
          !!session.pendingKey ||
          !!(session.job && isActiveJob(session.job)) ||
          (session.step === "intent" && session.brief.trim().length > 0 && !session.lastGood);
        setExitTo(keeps ? "dock" : "close");
        closeSession(session.id);
      }}
    >
      <AnimatePresence custom={exitTo}>
        {session ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-50 bg-background/60 backdrop-blur-[3px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: duration.slow } }}
                transition={{ duration: duration.base }}
              />
            </DialogPrimitive.Overlay>
            <div
              className={cn(
                "pointer-events-none fixed inset-0 z-50 grid place-items-center",
                !isMobile && "p-3",
              )}
            >
              <DialogPrimitive.Content
                asChild
                aria-describedby={undefined}
                onPointerDownOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => {
                  // Escape inside a field shouldn't close the whole composer.
                  const t = e.target as HTMLElement | null;
                  if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) e.preventDefault();
                }}
              >
                <motion.div
                  key={session.id}
                  custom={exitTo}
                  variants={{
                    initial: { opacity: 0, y: 14, scale: 0.985 },
                    open: { opacity: 1, y: 0, scale: 1 },
                    exit: (to: "dock" | "close") =>
                      to === "dock"
                        ? {
                            opacity: 0,
                            scale: 0.3,
                            x: isMobile ? 0 : "36vw",
                            y: "42vh",
                            transition: { duration: duration.slow + 0.06, ease: ease.accelerate },
                          }
                        : {
                            opacity: 0,
                            y: 20,
                            scale: 0.975,
                            transition: { duration: duration.base, ease: ease.accelerate },
                          },
                  }}
                  initial="initial"
                  animate="open"
                  exit="exit"
                  transition={spring.surface}
                  className={cn(
                    "pointer-events-auto relative flex flex-col overflow-hidden bg-surface-3 shadow-4 outline-none",
                    "transition-[width,height,border-radius] duration-[--motion-duration-slow] ease-[--motion-ease-emphasized]",
                    isMobile
                      ? "h-dvh w-screen"
                      : session.window === "maximized"
                        ? "h-full w-full rounded-2xl ring-1 ring-border/80"
                        : "h-[min(90vh,880px)] w-[min(95vw,1240px)] rounded-[20px] ring-1 ring-border/80",
                  )}
                >
                  <ComposerBody
                    session={session}
                    isMobile={isMobile}
                    onMinimize={() => toDock(session.id)}
                  />
                </motion.div>
              </DialogPrimitive.Content>
            </div>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

export function ComposerBody({
  session,
  isMobile,
  fixtures,
  onMinimize,
}: {
  session: StudioSession;
  isMobile: boolean;
  fixtures?: ComposerFixtures;
  onMinimize?: () => void;
}) {
  const format = STUDIO_FORMATS[session.type];
  const [cancelling, setCancelling] = useState(false);
  // Editing a brief is part of "Describe".
  const stepIndex = Math.max(
    0,
    STEPS.findIndex((s) => s.id === (session.step === "intent" ? "start" : session.step)),
  );
  const working = !!session.pendingKey || !!(session.job && isActiveJob(session.job));
  const minimize = onMinimize ?? (() => minimizeSession(session.id));
  // Maximize/restore animates the window size; soften the content while the
  // layout reflows so container-query changes don't visibly jump.
  const [resizing, setResizing] = useState(false);
  const resize = () => {
    if (isMobile) return;
    setResizing(true);
    toggleMaximize(session.id);
    window.setTimeout(() => setResizing(false), 340);
  };
  const title =
    session.step === "start"
      ? "New creation"
      : session.step === "intent"
        ? `New ${format.noun}`
        : (session.lastGood?.title ?? session.job?.title ?? session.brief.slice(0, 80)) ||
          format.label;

  const pickIdea = (idea: StudioIdea) => {
    rememberStudioType(idea.type);
    chooseType(session.id, idea.type, {
      brief: idea.brief,
      goal: idea.goal,
      ideaId: idea.id,
      ideaSource: idea.source,
      platforms: idea.platforms.length ? idea.platforms : undefined,
    });
  };

  return (
    <div className="@container/composer flex h-full min-h-0 flex-col">
      <header
        className="relative flex h-14 shrink-0 select-none items-center gap-2 border-b border-border/70 px-3 @3xl/composer:px-4"
        onDoubleClick={(e) => {
          // Standard window behaviour: double-click empty header space to maximize.
          if ((e.target as HTMLElement).closest("button, a, input, textarea, [role='tab']")) return;
          resize();
        }}
      >
        {session.step === "review" && !session.pendingKey ? (
          <Button
            size="icon-sm"
            variant="ghost"
            className="rounded-full"
            onClick={() => backToBrief(session.id)}
            aria-label="Back to brief"
            title="Back to brief"
          >
            <ArrowLeft />
          </Button>
        ) : null}
        {session.step === "start" ? (
          <span className="grid size-8 place-items-center studio-cta relative rounded-[10px] bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </span>
        ) : session.step === "intent" ? (
          <TypeSwitcher session={session} />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <TypeGlyph type={session.type} size="sm" />
            <span className="hidden text-xs text-muted-foreground sm:inline">{format.label}</span>
            <span aria-hidden className="hidden text-muted-foreground/50 sm:inline">
              /
            </span>
          </div>
        )}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={title}
            className="min-w-0 flex-1"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: duration.base, ease: ease.standard }}
          >
            <DialogPrimitive.Title className="truncate text-sm font-semibold tracking-tight text-foreground">
              {title}
            </DialogPrimitive.Title>
          </motion.div>
        </AnimatePresence>

        <ol className="mr-3 hidden items-center gap-2 @5xl/composer:flex" aria-label="Steps">
          {STEPS.map((s, i) => {
            const state = i < stepIndex ? "done" : i === stepIndex ? "current" : "todo";
            return (
              <li
                key={s.id}
                className="flex items-center gap-2"
                aria-current={state === "current" ? "step" : undefined}
              >
                <span className="flex items-center gap-1.5 text-xs">
                  <span
                    className={cn(
                      "grid size-4 place-items-center rounded-full transition-colors duration-[--motion-duration-slow]",
                      state === "done" && "bg-primary text-primary-foreground",
                      state === "current" && "ring-[1.5px] ring-primary",
                      state === "todo" && "ring-1 ring-border-strong",
                    )}
                  >
                    {state === "done" ? (
                      <Check className="size-2.5" strokeWidth={3.5} />
                    ) : state === "current" ? (
                      <span
                        className={cn(
                          "size-1.5 rounded-full bg-primary",
                          working && s.id === "generating" && "animate-pulse",
                        )}
                      />
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "transition-colors",
                      state === "current"
                        ? "font-medium text-foreground"
                        : state === "done"
                          ? "text-muted-foreground"
                          : "text-muted-foreground/60",
                    )}
                  >
                    {s.label}
                  </span>
                </span>
                {i < STEPS.length - 1 ? (
                  <span
                    aria-hidden
                    className={cn(
                      "h-px w-4 transition-colors duration-[--motion-duration-slow]",
                      i < stepIndex ? "bg-primary/60" : "bg-border",
                    )}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>

        <div className="flex items-center gap-0.5 rounded-full bg-surface-2/70 p-0.5">
          <WindowButton onClick={minimize} label="Minimize — keeps working">
            <Minus />
          </WindowButton>
          {!isMobile ? (
            <WindowButton
              onClick={resize}
              label={session.window === "maximized" ? "Restore size" : "Maximize"}
            >
              {session.window === "maximized" ? <Minimize2 /> : <Maximize2 />}
            </WindowButton>
          ) : null}
          <DialogPrimitive.Close asChild>
            <button
              type="button"
              aria-label="Close"
              title={working ? "Close — keeps working in the dock" : "Close"}
              className={WINDOW_BUTTON}
            >
              <X />
            </button>
          </DialogPrimitive.Close>
        </div>

        {/* A hairline of motion under the header whenever Mellox is working. */}
        <AnimatePresence>
          {working ? (
            <motion.span
              key="working"
              aria-hidden
              className="absolute inset-x-0 -bottom-px h-px overflow-hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.span
                className="absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-primary to-[hsl(var(--tone-video))]"
                animate={{ x: ["-100%", "500%"] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
              />
            </motion.span>
          ) : null}
        </AnimatePresence>
      </header>

      <div
        className={cn(
          "relative min-h-0 flex-1 transition-opacity duration-150",
          resizing && "opacity-60",
        )}
      >
        {/* Enter-only: generating re-renders every second, which can strand an exit and blank the window. */}
        <>
          <motion.div
            key={session.step}
            className="absolute inset-0 overflow-hidden"
            initial={{
              opacity: 0,
              y: session.step === "review" ? 12 : 8,
              scale: session.step === "review" ? 0.99 : 1,
            }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{
              opacity: 0,
              y: session.step === "generating" ? 0 : -6,
              scale: session.step === "generating" ? 1.01 : 1,
            }}
            transition={{ duration: duration.medium, ease: ease.emphasized }}
          >
            {session.step === "start" ? (
              <StartStep
                workspaceId={session.workspaceId}
                initialType={session.type}
                fixtureIdeas={fixtures?.ideas}
                onQuickGenerate={(type, brief, { controls, template }) => {
                  rememberStudioType(type);
                  chooseType(session.id, type, {
                    brief,
                    template,
                    goal: getTemplate(template)?.goal,
                    controls,
                  });
                  void generate(session.id, { kind: "generate" });
                }}
                onGenerateIdea={(idea) => {
                  pickIdea(idea);
                  void generate(session.id, { kind: "generate" });
                }}
              />
            ) : session.step === "intent" ? (
              <IntentStep
                session={session}
                isMobile={isMobile}
                fixtureIdeas={fixtures?.ideas}
                onPickIdea={pickIdea}
              />
            ) : session.step === "generating" ? (
              <div className="h-full overflow-y-auto">
                <GenerationProgress
                  session={session}
                  cancelling={cancelling}
                  onMinimize={minimize}
                  onCancel={async () => {
                    setCancelling(true);
                    await cancelSession(session.id);
                    setCancelling(false);
                  }}
                />
              </div>
            ) : session.lastGood || session.job ? (
              <ReviewPanel
                session={session}
                fixtureRows={fixtures?.rows}
                fixtureDistribution={fixtures?.distribution}
              />
            ) : null}
          </motion.div>
        </>
      </div>
    </div>
  );
}

const WINDOW_BUTTON =
  "grid size-7 place-items-center rounded-full text-muted-foreground transition-colors duration-[--motion-duration-fast] hover:bg-surface-3 hover:text-foreground hover:shadow-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 [&_svg]:size-3.5";

function WindowButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={WINDOW_BUTTON}
    >
      {children}
    </button>
  );
}

function TypeSwitcher({ session }: { session: StudioSession }) {
  const [open, setOpen] = useState(false);
  const format = STUDIO_FORMATS[session.type];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-h-9 items-center gap-2 rounded-lg px-1.5 pr-2 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
          aria-label={`Format: ${format.label}. Change format`}
        >
          <TypeGlyph type={session.type} size="sm" />
          <span className="hidden text-sm font-medium text-foreground sm:inline">
            {format.label}
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[70vh] w-[min(92vw,520px)] overflow-y-auto p-3"
      >
        <TypePicker
          value={session.type}
          onPick={(type: StudioType) => {
            rememberStudioType(type);
            updateSession(session.id, { type });
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** What the brief will produce: a live blueprint that follows every setting. */
function WhatYoullGet({ session, compact }: { session: StudioSession; compact?: boolean }) {
  const format = STUDIO_FORMATS[session.type];
  const c = session.controls;
  const template = getTemplate(session.template);
  const count = c.platforms.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (count < 2 || paused) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % count), 3200);
    return () => window.clearInterval(t);
  }, [count, paused]);
  const active = count ? index % count : 0;
  const platform = c.platforms[active];
  const showsMedia =
    format.media === "image" ||
    format.media === "video" ||
    (format.media === "optional-image" && c.includeImage) ||
    session.type === "carousel";
  const ratio = c.ratio ?? format.ratios[0];
  const rows: { key: string; icon: React.ReactNode; text: string }[] = [
    ...(template
      ? [
          {
            key: `t-${template.id}`,
            icon: <LayoutTemplate className="size-3.5 shrink-0 text-[hsl(var(--tone))]" />,
            text: template.beats.join(" → "),
          },
        ]
      : []),
    ...(count > 1
      ? [
          {
            key: `p-${count}`,
            icon: <Check className="size-3.5 shrink-0 text-primary" />,
            text: `${count} native versions, one per platform`,
          },
        ]
      : []),
    ...(showsMedia && ratio && format.media !== "none"
      ? [
          {
            key: `m-${ratio}`,
            icon: <Check className="size-3.5 shrink-0 text-primary" />,
            text: `${session.type === "video" ? "Video" : session.type === "carousel" ? "Designed slides" : "Visual"} sized ${RATIOS[ratio].label.toLowerCase()} ${ratio}`,
          },
        ]
      : []),
    { key: "time", icon: <Clock className="size-3.5 shrink-0" />, text: format.estimate },
    {
      key: "inbox",
      icon: <Inbox className="size-3.5 shrink-0" />,
      text: "Waits in Needs Approval",
    },
  ];

  return (
    <section
      data-no-rhythm
      aria-label="What you'll get"
      className={`studio-tone-${session.type} shrink-0 overflow-hidden rounded-2xl bg-surface-3 shadow-1 ring-1 ring-border/70`}
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5">
        <p className="ui-eyebrow">You'll get</p>
        <motion.span
          key={template?.id ?? session.type}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="truncate text-[11px] font-medium text-[hsl(var(--tone))]"
        >
          {template ? template.label : format.label}
        </motion.span>
      </div>
      <div
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className={cn(
          "studio-canvas relative mx-3 mt-3 flex items-center justify-center overflow-hidden rounded-xl ring-1 ring-border/60",
          compact ? "h-[260px]" : "h-[360px]",
        )}
      >
        <div aria-hidden className="studio-aurora studio-aurora-soft" />
        <div
          className={cn(
            "relative flex w-[520px] shrink-0 origin-center justify-center",
            compact ? "scale-[0.48]" : "scale-[0.62]",
          )}
        >
          <PreviewSkeleton
            session={session}
            stageIndex={-1}
            platform={platform}
            template={template}
          />
        </div>
      </div>
      {count > 1 ? (
        <div
          className="mt-2.5 flex justify-center gap-1.5"
          role="tablist"
          aria-label="Preview platform"
        >
          {c.platforms.map((p, i) => {
            const Icon = PLATFORMS[p].icon;
            const on = i === active;
            return (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={on}
                aria-label={PLATFORMS[p].label}
                title={PLATFORMS[p].label}
                onClick={() => {
                  setIndex(i);
                  setPaused(true);
                }}
                className={cn(
                  "grid size-7 place-items-center rounded-full ring-1 transition-colors duration-[--motion-duration-fast]",
                  on
                    ? "bg-[hsl(var(--tone)/0.14)] text-foreground ring-[hsl(var(--tone)/0.5)]"
                    : "text-muted-foreground ring-border/60 hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
              </button>
            );
          })}
        </div>
      ) : null}
      <ul className="m-3 space-y-1.5 rounded-xl bg-surface-2/60 px-3 py-2.5 text-xs text-muted-foreground [&_li]:text-xs [&_li]:leading-5">
        {rows.map((r, i) => (
          <motion.li
            key={r.key}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04, duration: duration.medium, ease: ease.emphasized }}
            className="flex items-center gap-2"
          >
            {r.icon}
            <span className="min-w-0 truncate">{r.text}</span>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}

export function IntentStep({
  session,
  isMobile,
  onPickIdea,
  fixtureIdeas,
}: {
  session: StudioSession;
  isMobile: boolean;
  onPickIdea: (idea: StudioIdea) => void;
  fixtureIdeas?: StudioIdea[];
}) {
  const format = STUDIO_FORMATS[session.type];
  const textarea = useRef<HTMLTextAreaElement>(null);
  const ready = session.brief.trim().length >= 3;
  const busy = !!session.pendingKey;
  const template = getTemplate(session.template);
  const blanks = countBlanks(session.brief);
  const hasBrand = useMemo(() => !!readBrandPayload(session.workspaceId), [session.workspaceId]);
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);
  useEffect(() => {
    if (!isMobile) textarea.current?.focus();
  }, [session.id, session.type, isMobile]);

  const submit = () => {
    if (ready && !busy)
      void generate(session.id, { kind: session.lastGood ? "regenerate" : "generate" });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-y-auto @5xl/composer:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] @5xl/composer:overflow-hidden">
        <div className="min-w-0 p-5 @3xl/composer:p-8 @5xl/composer:overflow-y-auto">
          <div className="mx-auto min-w-0 max-w-2xl space-y-6">
            <div>
              <label
                htmlFor="studio-brief"
                className="block text-xl font-semibold tracking-tight text-foreground"
              >
                What should this{" "}
                <span className={`studio-gradient-text studio-tone-${session.type}`}>
                  {format.noun}
                </span>{" "}
                achieve?
              </label>
              <p className="mt-1 text-sm text-muted-foreground">
                One or two sentences is enough — Mellox brings your brand, audience and what you've
                posted recently.
              </p>

              <TemplateGallery session={session} textareaRef={textarea} className="mt-5" />

              <div
                className={cn(
                  "mt-4 rounded-2xl border bg-surface-3 shadow-1 transition-[border-color,box-shadow]",
                  "focus-within:border-primary-border focus-within:shadow-[0_0_0_4px_hsl(var(--primary)/0.12),0_22px_50px_-22px_hsl(var(--primary)/0.5)]",
                  session.error ? "border-danger-border" : "border-input",
                )}
              >
                {template ? (
                  <div
                    className={`studio-tone-${session.type} flex items-center gap-2 border-b border-border px-3.5 py-2 text-xs text-muted-foreground`}
                  >
                    <LayoutTemplate className="size-3.5 text-[hsl(var(--tone))]" />
                    <span className="font-medium text-foreground">{template.label}</span>
                    <span className="hidden min-w-0 flex-1 truncate sm:inline">
                      · replace the [brackets] with your details
                    </span>
                    <button
                      type="button"
                      onClick={() => applyTemplate(session.id, null)}
                      className="ml-auto rounded px-1.5 py-0.5 hover:bg-surface-2 hover:text-foreground"
                    >
                      Remove
                    </button>
                  </div>
                ) : null}
                {session.ideaId ? (
                  <div className="flex items-center gap-2 border-b border-border px-3.5 py-2 text-xs text-muted-foreground">
                    <Sparkles className="size-3.5 text-primary" />
                    <span className="flex-1">Started from a suggested idea — edit it freely.</span>
                    <button
                      type="button"
                      onClick={() =>
                        updateSession(session.id, {
                          brief: "",
                          ideaId: undefined,
                          ideaSource: undefined,
                        })
                      }
                      className="rounded px-1.5 py-0.5 hover:bg-surface-2 hover:text-foreground"
                    >
                      Clear
                    </button>
                  </div>
                ) : null}
                <textarea
                  id="studio-brief"
                  ref={textarea}
                  value={session.brief}
                  onChange={(e) =>
                    updateSession(session.id, { brief: e.target.value, error: null })
                  }
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder={format.placeholder}
                  rows={isMobile ? 4 : 5}
                  maxLength={4000}
                  aria-describedby={session.error ? "studio-brief-error" : undefined}
                  className="block w-full resize-none !border-0 !bg-transparent px-3.5 pt-3 text-base leading-relaxed text-foreground !shadow-none outline-none placeholder:text-muted-foreground focus-visible:!ring-0 @3xl/composer:text-[15px]"
                />
                {template ? (
                  <div className={`studio-tone-${session.type} px-3.5 pb-1 pt-1`}>
                    <BeatPills beats={template.beats} />
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 px-3.5 pb-2.5 pt-1 text-xs">
                  {hasBrand ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Check className="size-3.5 text-primary" strokeWidth={2.5} />
                      Brand DNA in use
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => emitAppEvent("open:brand-dna", { tab: "essentials" })}
                      className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      <Sparkles className="size-3.5 text-primary" />
                      Add Brand DNA for sharper drafts
                    </button>
                  )}
                  <span className="ml-auto tabular-nums text-muted-foreground/70">
                    {blanks ? (
                      <span
                        className={`studio-tone-${session.type} font-medium text-[hsl(var(--tone))]`}
                      >
                        {blanks} blank{blanks === 1 ? "" : "s"} · optional
                      </span>
                    ) : session.brief.length > 3500 ? (
                      `${session.brief.length}/4000`
                    ) : null}
                  </span>
                </div>
              </div>
              {session.error ? (
                <p id="studio-brief-error" role="alert" className="mt-2 text-sm text-danger">
                  {session.error}
                </p>
              ) : null}
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-foreground">
                Goal <span className="font-normal text-muted-foreground">· optional</span>
              </p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Goal">
                {GOALS.map((g) => (
                  <ChipButton
                    key={g.id}
                    selected={session.goal === g.id}
                    onClick={() =>
                      updateSession(session.id, { goal: session.goal === g.id ? undefined : g.id })
                    }
                  >
                    {session.goal === g.id ? (
                      <Check className="size-3 text-primary" strokeWidth={3} />
                    ) : null}
                    {g.label}
                  </ChipButton>
                ))}
              </div>
            </div>

            <div className="@5xl/composer:hidden">
              <WhatYoullGet session={session} compact />
            </div>

            <ControlsPanel session={session} disabled={busy} />

            <div className="@5xl/composer:hidden">
              <IdeasPanel
                workspaceId={session.workspaceId}
                type={session.type}
                selectedId={session.ideaId}
                onPick={onPickIdea}
                limit={3}
                fixtureIdeas={fixtureIdeas}
              />
            </div>
          </div>
        </div>

        <aside className="hidden flex-col gap-6 border-l border-border bg-surface-1 p-5 @5xl/composer:flex @5xl/composer:overflow-y-auto">
          <WhatYoullGet session={session} />
          <IdeasPanel
            workspaceId={session.workspaceId}
            type={session.type}
            selectedId={session.ideaId}
            onPick={onPickIdea}
            fixtureIdeas={fixtureIdeas}
          />
        </aside>
      </div>

      <footer className="flex items-center gap-3 border-t border-border bg-surface-3 px-4 py-3 @3xl/composer:px-6">
        {!session.job && !session.lastGood ? (
          <Button variant="ghost" size="sm" onClick={() => backToStart(session.id)}>
            <ArrowLeft />
            <span className="hidden sm:inline">Formats</span>
          </Button>
        ) : null}
        <p className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground @3xl/composer:block">
          Nothing is published without your approval.
        </p>
        <div className="ml-auto flex items-center gap-3">
          <kbd className="hidden items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground ring-1 ring-border @3xl/composer:inline-flex">
            {isMac ? "⌘" : "Ctrl"} ↵
          </kbd>
          <Button onClick={submit} disabled={!ready || busy} size="lg" className="studio-cta">
            <Wand2 />
            {busy
              ? "Starting…"
              : session.lastGood
                ? "Generate new version"
                : `Generate ${format.noun}`}
          </Button>
        </div>
      </footer>
    </div>
  );
}
