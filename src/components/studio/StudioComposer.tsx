"use client";

import { Spinner } from "@/components/icons";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Maximize2, Minimize2 } from "lucide-react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  LayoutTemplate,
  Minus,
  Sparkles,
  Wand2,
  X,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { rememberStudioType } from "@/hooks/use-studio";
import { emitAppEvent } from "@/lib/app-events";
import { cn } from "@/lib/utils";
import { duration, ease, spring } from "@/lib/motion";
import { isActiveJob } from "@/lib/studio/jobs";
import { readBrandPayload } from "@/lib/studio/client";
import { STUDIO_FORMATS, type StudioType } from "@/lib/studio/formats";
import type { StudioIdea } from "@/lib/studio/ideas";
import { GOALS } from "@/lib/studio/jobs";
import { PLATFORMS } from "@/lib/social-platforms";
import { countBlanks, getTemplate, templatesFor } from "@/lib/studio/templates";
import {
  applyTemplate,
  backToBrief,
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
import { StylePicker } from "@/components/app/brand-kit/StylePicker";
import { GenerationProgress } from "./GenerationProgress";
import { IdeasPanel } from "./IdeasPanel";
import { ReviewPanel, type ReviewRow } from "./ReviewPanel";
import { PreviewSkeleton } from "./previews/PreviewSkeleton";
import { usePromptWriter, WriteForMeButton, WritingOverlay, WrittenNote } from "./PromptWriter";
import { BeatPills, TemplateGallery } from "./TemplateGallery";
import { ChipButton, TypeGlyph } from "./studio-ui";
import { TypePicker } from "./TypePicker";

const STEPS = [
  { id: "intent", label: "Describe" },
  { id: "generating", label: "Generate" },
  { id: "review", label: "Review" },
] as const;

/** Preview/testing data so the composer can render without a signed-in workspace. */
export type ComposerFixtures = { ideas?: StudioIdea[]; rows?: ReviewRow[]; distribution?: boolean };

/**
 * The Studio composer: one surface that carries a piece of work from
 * description to approval. It opens as a centred window, maximizes to the
 * full screen, minimizes to the dock while it keeps working, and closes
 * without losing anything.
 */
export function StudioComposer() {
  const workspaceId = useOptionalWorkspaceId();
  const session = useStudioStore(
    (s) =>
      s.sessions.find(
        (x) =>
          x.id === s.activeId &&
          x.window !== "minimized" &&
          // Previews render without a workspace; in the app, only this one's.
          (workspaceId === null || x.workspaceId === workspaceId),
      ) ?? null,
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

  const fullScreen = !!session && (isMobile || session.window === "maximized");

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
                className={cn(
                  "fixed inset-0 z-50 transition-[background-color,backdrop-filter] duration-[--motion-duration-slow]",
                  fullScreen ? "bg-background" : "bg-black/45 backdrop-blur-[6px]",
                )}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: duration.slow } }}
                transition={{ duration: duration.base }}
              />
            </DialogPrimitive.Overlay>
            <div
              className={cn(
                "pointer-events-none fixed inset-0 z-50 grid place-items-center transition-[padding] duration-[--motion-duration-slow] ease-[--motion-ease-emphasized]",
                fullScreen ? "p-0" : "p-4",
              )}
            >
              <DialogPrimitive.Content
                asChild
                aria-describedby={undefined}
                onPointerDownOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => {
                  // Escape inside a field shouldn't close the whole composer.
                  const t = e.target as HTMLElement | null;
                  if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) {
                    e.preventDefault();
                    return;
                  }
                  // From full screen, Escape first returns to the window.
                  if (!isMobile && session.window === "maximized") {
                    e.preventDefault();
                    toggleMaximize(session.id);
                  }
                }}
              >
                <motion.div
                  key={session.id}
                  custom={exitTo}
                  variants={{
                    initial: { opacity: 0, y: 18, scale: 0.97 },
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
                            y: 16,
                            scale: 0.975,
                            transition: { duration: duration.base, ease: ease.accelerate },
                          },
                  }}
                  initial="initial"
                  animate="open"
                  exit="exit"
                  transition={spring.surface}
                  className={cn(
                    "pointer-events-auto relative flex flex-col overflow-hidden bg-surface-3 outline-none",
                    "transition-[width,height,border-radius,box-shadow] duration-[--motion-duration-slow] ease-[--motion-ease-emphasized]",
                    fullScreen
                      ? "h-dvh w-screen rounded-none"
                      : "h-[min(88dvh,860px)] w-[min(94vw,1180px)] rounded-[22px] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.55)] ring-1 ring-border/70",
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
  const stepIndex = Math.max(
    0,
    STEPS.findIndex((s) => s.id === session.step),
  );
  const working = !!session.pendingKey || !!(session.job && isActiveJob(session.job));
  const minimize = onMinimize ?? (() => minimizeSession(session.id));
  const maximized = session.window === "maximized";
  // Maximize/restore animates the window size; soften the content while the
  // layout reflows so container-query changes don't visibly jump.
  const [resizing, setResizing] = useState(false);
  const resize = () => {
    if (isMobile) return;
    setResizing(true);
    toggleMaximize(session.id);
    window.setTimeout(() => setResizing(false), 360);
  };
  const title =
    session.step === "intent"
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
        className="relative z-10 flex h-14 shrink-0 select-none items-center gap-2 border-b border-border/60 bg-surface-3 px-3 @3xl/composer:gap-3 @3xl/composer:px-5"
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
            aria-label="Back to description"
            title="Back to description"
          >
            <ArrowLeft />
          </Button>
        ) : null}
        {session.step === "intent" ? (
          <TypeSwitcher session={session} />
        ) : (
          <span className="flex shrink-0 items-center gap-2 rounded-full bg-surface-2/80 py-1 pl-1 pr-3 ring-1 ring-border/60">
            <TypeGlyph type={session.type} size="sm" className="rounded-full" />
            <span className="hidden text-xs font-medium text-foreground sm:inline">
              {format.label}
            </span>
          </span>
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

        <StepIndicator index={stepIndex} working={working} />

        <TooltipProvider delayDuration={300}>
          <div className="flex shrink-0 items-center gap-0.5">
            <WindowButton
              onClick={minimize}
              label={working ? "Minimize — keeps going" : "Minimize"}
            >
              <Minus />
            </WindowButton>
            {!isMobile ? (
              <WindowButton onClick={resize} label={maximized ? "Exit full screen" : "Full screen"}>
                {maximized ? <Minimize2 /> : <Maximize2 />}
              </WindowButton>
            ) : null}
            <DialogPrimitive.Close asChild>
              <WindowButton label="Close">
                <X />
              </WindowButton>
            </DialogPrimitive.Close>
          </div>
        </TooltipProvider>

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
                className="absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-primary to-transparent"
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
        <motion.div
          key={session.step}
          className={cn("absolute inset-0 overflow-hidden", maximized && "mx-auto max-w-[1680px]")}
          initial={{
            opacity: 0,
            y: session.step === "review" ? 14 : 10,
            scale: session.step === "review" ? 0.99 : 1,
            filter: "blur(4px)",
          }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          transition={{ duration: duration.medium, ease: ease.emphasized }}
        >
          {session.step === "intent" ? (
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
      </div>
    </div>
  );
}

/** Describe → Generate → Review, with a sliding highlight on the current step. */
function StepIndicator({ index, working }: { index: number; working: boolean }) {
  const reduce = useReducedMotion();
  return (
    <ol
      className="relative hidden items-center rounded-full bg-surface-2/80 p-1 ring-1 ring-border/60 @4xl/composer:flex"
      aria-label="Steps"
    >
      {STEPS.map((s, i) => {
        const state = i < index ? "done" : i === index ? "current" : "todo";
        return (
          <li
            key={s.id}
            aria-current={state === "current" ? "step" : undefined}
            className="relative flex h-7 items-center gap-1.5 px-3 text-xs"
          >
            {state === "current" ? (
              <motion.span
                layoutId="composer-step"
                className="absolute inset-0 rounded-full bg-surface-3 shadow-1 ring-1 ring-border/70"
                transition={
                  reduce ? { duration: 0 } : { duration: duration.medium, ease: ease.emphasized }
                }
              />
            ) : null}
            <span
              className={cn(
                "relative grid size-4 place-items-center rounded-full text-[9px] font-semibold tabular-nums transition-colors duration-[--motion-duration-slow]",
                state === "done" && "bg-primary text-primary-foreground",
                state === "current" && "bg-foreground text-background",
                state === "todo" && "text-muted-foreground ring-1 ring-border-strong",
              )}
            >
              {state === "done" ? (
                <Check className="size-2.5" strokeWidth={3.5} />
              ) : state === "current" && working && s.id === "generating" ? (
                <span className="size-1.5 animate-pulse rounded-full bg-background" />
              ) : (
                i + 1
              )}
            </span>
            <span
              className={cn(
                "relative transition-colors",
                state === "current"
                  ? "font-medium text-foreground"
                  : state === "done"
                    ? "text-foreground/70"
                    : "text-muted-foreground",
              )}
            >
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const WindowButton = forwardRef<
  HTMLButtonElement,
  { label: string; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function WindowButton({ label, children, className, ...rest }, ref) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type="button"
          {...rest}
          aria-label={label}
          className={cn(
            "grid size-8 place-items-center rounded-full text-muted-foreground transition-colors duration-[--motion-duration-fast] hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 [&_svg]:size-4",
            className,
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
});

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

/** A live preview of what the brief will produce; it follows every setting. */
function WhatYoullGet({ session }: { session: StudioSession }) {
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

  return (
    <section
      data-no-rhythm
      aria-label="Preview"
      className={`studio-tone-${session.type} shrink-0 overflow-hidden rounded-2xl bg-surface-3 pb-3 shadow-1 ring-1 ring-border/70`}
    >
      <p className="ui-eyebrow px-4 pt-3.5">Preview</p>
      <div
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className="studio-canvas relative mx-3 mt-3 flex h-[360px] items-center justify-center overflow-hidden rounded-xl ring-1 ring-border/60"
      >
        <div aria-hidden className="studio-aurora studio-aurora-soft" />
        <div className="relative flex w-[520px] shrink-0 origin-center scale-[0.62] justify-center">
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
  const hasTemplates = templatesFor(session.type).length > 0;
  const writer = usePromptWriter(session);
  // Templates lead while the box is empty; once someone writes their own, they tuck away.
  const [templatesPicked, setTemplatesPicked] = useState<boolean | null>(null);
  const showTemplates =
    hasTemplates && (templatesPicked ?? (!session.brief.trim() || !!session.template));

  useEffect(() => {
    if (!isMobile) textarea.current?.focus();
  }, [session.id, session.type, isMobile]);

  const submit = () => {
    if (ready && !busy && !writer.busy)
      void generate(session.id, { kind: session.lastGood ? "regenerate" : "generate" });
  };

  const backToFormats = () => {
    // A typed brief is kept in the dock; an empty one is simply closed.
    closeSession(session.id);
    emitAppEvent("open:create-launcher");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-y-auto @5xl/composer:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] @5xl/composer:overflow-hidden">
        <div className="min-w-0 p-5 @3xl/composer:p-8 @5xl/composer:overflow-y-auto">
          <div className="studio-stagger mx-auto min-w-0 max-w-2xl space-y-7">
            <div>
              <label
                htmlFor="studio-brief"
                className="block text-xl font-semibold tracking-tight text-foreground"
              >
                Describe your{" "}
                <span className={`studio-gradient-text studio-tone-${session.type}`}>
                  {format.noun}
                </span>
              </label>

              <div
                className={cn(
                  "relative mt-4 rounded-2xl border bg-surface-3 shadow-1 transition-[border-color,box-shadow]",
                  "focus-within:border-primary-border focus-within:shadow-[0_0_0_4px_hsl(var(--primary)/0.12),0_22px_50px_-22px_hsl(var(--primary)/0.5)]",
                  session.error ? "border-danger-border" : "border-input",
                )}
              >
                <WritingOverlay writer={writer} />
                {template ? (
                  <div
                    className={`studio-tone-${session.type} flex items-center gap-2 border-b border-border px-3.5 py-2 text-xs text-muted-foreground`}
                  >
                    <LayoutTemplate className="size-3.5 text-[hsl(var(--tone))]" />
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {template.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => applyTemplate(session.id, null)}
                      className="rounded px-1.5 py-0.5 hover:bg-surface-2 hover:text-foreground"
                    >
                      Remove
                    </button>
                  </div>
                ) : session.ideaId ? (
                  <div className="flex items-center gap-2 border-b border-border px-3.5 py-2 text-xs text-muted-foreground">
                    <Sparkles className="size-3.5 text-primary" />
                    <span className="flex-1">From a suggested idea</span>
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
                  readOnly={writer.busy}
                  aria-busy={writer.busy}
                  aria-describedby={session.error ? "studio-brief-error" : undefined}
                  className="block max-h-[28rem] min-h-[8.5rem] w-full resize-none overflow-y-auto !border-0 !bg-transparent px-3.5 pt-3 text-base leading-relaxed text-foreground !shadow-none outline-none [field-sizing:content] placeholder:text-muted-foreground focus-visible:!ring-0 @3xl/composer:text-[15px]"
                />
                {template ? (
                  <div className={`studio-tone-${session.type} px-3.5 pb-1 pt-1`}>
                    <BeatPills beats={template.beats} />
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-3 px-3 pb-3 pt-1.5 text-xs">
                  <WriteForMeButton writer={writer} />
                  {hasTemplates ? (
                    <button
                      type="button"
                      onClick={() => setTemplatesPicked(!showTemplates)}
                      aria-expanded={showTemplates}
                      className={cn(
                        "inline-flex items-center gap-1 font-medium transition-colors",
                        showTemplates
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <LayoutTemplate className="size-3.5" />
                      {showTemplates ? "Hide templates" : "Templates"}
                    </button>
                  ) : null}
                  {!hasBrand ? (
                    <button
                      type="button"
                      onClick={() => emitAppEvent("open:brand-dna", { tab: "essentials" })}
                      className="inline-flex items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Sparkles className="size-3.5 text-primary" />
                      Add Brand DNA
                    </button>
                  ) : null}
                  {blanks ? (
                    <span
                      className={`studio-tone-${session.type} ml-auto font-medium tabular-nums text-[hsl(var(--tone))]`}
                    >
                      {blanks} to fill in
                    </span>
                  ) : null}
                </div>
              </div>
              <WrittenNote writer={writer} />
              {session.error ? (
                <p id="studio-brief-error" role="alert" className="mt-2 text-sm text-danger">
                  {session.error}
                </p>
              ) : null}

              {showTemplates ? (
                <TemplateGallery
                  session={session}
                  textareaRef={textarea}
                  className="mt-5"
                  onWriteOwn={() => {
                    setTemplatesPicked(false);
                    textarea.current?.focus();
                  }}
                />
              ) : null}
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-foreground">Goal</p>
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

            <div>
              <p className="mb-2 text-xs font-medium text-foreground">Style</p>
              <StylePicker
                workspaceId={session.workspaceId}
                value={session.styleId}
                format={session.type}
                disabled={busy}
                onChange={(styleId) => updateSession(session.id, { styleId })}
              />
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

        <aside className="studio-stagger hidden flex-col gap-6 border-l border-border/60 bg-surface-1 p-5 @5xl/composer:flex @5xl/composer:overflow-y-auto">
          <WhatYoullGet session={session} />
          <IdeasPanel
            workspaceId={session.workspaceId}
            type={session.type}
            selectedId={session.ideaId}
            onPick={onPickIdea}
            limit={4}
            fixtureIdeas={fixtureIdeas}
          />
        </aside>
      </div>

      <footer className="flex items-center gap-3 border-t border-border bg-surface-3 px-4 py-3 @3xl/composer:px-6">
        {!session.job && !session.lastGood ? (
          <Button variant="ghost" size="sm" onClick={backToFormats}>
            <ArrowLeft />
            Back
          </Button>
        ) : null}
        <Button
          onClick={submit}
          disabled={!ready || busy || writer.busy}
          size="lg"
          className="studio-cta ml-auto"
        >
          {busy ? <Spinner className="animate-spin" aria-hidden /> : <Wand2 />}
          {busy ? "Starting…" : session.lastGood ? "Generate again" : "Generate"}
        </Button>
      </footer>
    </div>
  );
}
