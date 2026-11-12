"use client";

import { Spinner } from "@/components/icons";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Maximize2, Minimize2 } from "lucide-react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  LayoutTemplate,
  Minus,
  Repeat2,
  Sparkles,
  Wand2,
  X,
  SlidersHorizontal,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { rememberStudioType } from "@/hooks/use-studio";
import { emitAppEvent } from "@/lib/app-events";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { duration, ease, spring } from "@/lib/motion";
import { isActiveJob } from "@/lib/studio/jobs";
import { readBrandPayload, studioApi } from "@/lib/studio/client";
import { STUDIO_FORMATS, type StudioType } from "@/lib/studio/formats";
import { studioChargeFor, studioPriceLabel } from "@/lib/studio/billing";
import { shortClipPlan, shortClipPrice } from "@/lib/studio/short-clip";
import type { CreditAction } from "@/lib/billing/catalog";
import { RECAP_AI_SECONDS } from "@/lib/studio/clip-edit";
import { resolvePhotoMode } from "@/lib/studio/photo-design/mode";
import { useBriefProduct, withProductPhotos } from "./ProductAndFormat";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { CostChip } from "@/components/app/CostChip";
import { UpgradePrompt } from "@/components/app/billing/UpgradePrompt";
import { closeOnlyFromSidebar, useCanvasHost, useShellWindow } from "@/lib/shell/window";
import { WindowErrorBoundary } from "@/components/ui/window-error-boundary";
import { studioVideoUnits } from "@/lib/ugc/duration";
import type { StudioIdea } from "@/lib/studio/ideas";
import { GOALS } from "@/lib/studio/jobs";
import { countBlanks, getTemplate } from "@/lib/studio/templates";
import {
  applyTemplate,
  backToBrief,
  cancelSession,
  chooseType,
  closeSession,
  focusSession,
  generate,
  getActiveSessionId,
  getSession,
  minimizeSession,
  needsVideoQuote,
  toggleMaximize,
  updateSession,
  useStudioStore,
  type StudioSession,
} from "@/lib/studio/session-store";
import { needsStoryboard, withStoryboard } from "@/lib/studio/video/board";
import { ControlsPanel, PlatformControls } from "./ControlsPanel";
import { AdObjectivePicker, ProductPicker } from "./ProductAndFormat";
import { SourceClips } from "./SourceClips";
import { canvasPickers, missingFor, startFor } from "@/lib/studio/start";
import {
  AttachButtons,
  DropHint,
  LibraryPicker,
  MediaStrip,
  PhotoUse,
  usePromptMedia,
} from "./PromptMedia";
import { GenerationProgress } from "./GenerationProgress";
import { IdeasPanel } from "./IdeasPanel";
import { VideoCanvasSettings } from "./VideoCanvasSettings";
import { ReviewPanel, type ReviewRow } from "./ReviewPanel";
import { usePromptWriter, WriteForMeButton, WritingOverlay, WrittenNote } from "./PromptWriter";
import { ScriptPreview } from "./previews/ScriptPreview";
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
  const { data: billing } = useEntitlements({ enabled: Boolean(workspaceId) });
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
    if (session && billing && !session.pendingKey && !session.job) {
      const controls = { ...session.controls };
      let changed = false;
      if (
        !controls.paymentSourceExplicit &&
        controls.paymentSource !== (billing.creation?.active ? "creation" : "credits")
      ) {
        controls.paymentSource = billing.creation?.active ? "creation" : "credits";
        changed = true;
      }
      if (
        (session.type === "video" ||
          (session.type === "story" && controls.storyMode === "video")) &&
        !controls.videoModelKey
      ) {
        controls.videoModelKey = "standard";
        controls.videoQuote = undefined;
        changed = true;
      }
      if (changed) updateSession(session.id, { controls });
    }
  }, [session, billing]);
  useEffect(() => {
    if (sessionId) setExitTo("close");
  }, [sessionId]);

  const toDock = (id: string) => {
    setExitTo("dock");
    minimizeSession(id);
  };

  // Desktop (Holo): the composer is a page drawn inside the canvas, never a
  // pop-up over it: the sidebar stays in view and usable, and it leaves at
  // once when a person goes somewhere else.
  const host = useCanvasHost(!!session && !isMobile);
  const inCanvas = Boolean(host);
  const waiting = !!session && !isMobile && host === undefined;
  const fullScreen = !!session && !inCanvas && (isMobile || session.window === "maximized");
  // A sidebar press leaves Studio: work in progress (or a typed brief) goes to
  // the corner list / dock, an empty page simply closes.
  useShellWindow("create", !!session, () => {
    const s = sessionId ? getSession(sessionId) : undefined;
    if (!s) return;
    const keeps =
      !!s.pendingKey ||
      !!(s.job && isActiveJob(s.job)) ||
      (s.step === "intent" && s.brief.trim().length > 0 && !s.lastGood);
    setExitTo(keeps ? "dock" : "close");
    closeSession(s.id);
  });

  const contentProps = {
    onPointerDownOutside: (e: Event) => (inCanvas ? closeOnlyFromSidebar(e) : e.preventDefault()),
    onInteractOutside: (e: Event) => {
      if (inCanvas) closeOnlyFromSidebar(e);
    },
    onEscapeKeyDown: (e: KeyboardEvent) => {
      // Escape inside a field shouldn't close the whole composer.
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) {
        e.preventDefault();
        return;
      }
      // From full screen, Escape first returns to the window.
      if (session && fullScreen && !isMobile) {
        e.preventDefault();
        toggleMaximize(session.id);
      }
    },
  };

  return (
    <DialogPrimitive.Root
      open={!!session}
      modal={!inCanvas}
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
      {host ? (
        session ? (
          <DialogPrimitive.Portal forceMount container={host}>
            <DialogPrimitive.Content asChild aria-describedby={undefined} {...contentProps}>
              <div
                key={session.id}
                data-modal="false"
                data-canvas-window
                className="ds-canvas ds-enter isolate absolute inset-0 flex flex-col overflow-hidden outline-none"
              >
                {/* A crash stays in Studio; the piece keeps being made on the server. */}
                <WindowErrorBoundary resetKey={session.id} onClose={() => closeSession(session.id)}>
                  <ComposerBody
                    session={session}
                    isMobile={isMobile}
                    embedded
                    onMinimize={() => minimizeSession(session.id)}
                  />
                </WindowErrorBoundary>
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null
      ) : (
        <AnimatePresence custom={exitTo}>
          {session && !waiting ? (
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
                <DialogPrimitive.Content asChild aria-describedby={undefined} {...contentProps}>
                  <motion.div
                    key={session.id}
                    custom={exitTo}
                    data-modal="true"
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
                      "ds-canvas pointer-events-auto relative flex flex-col overflow-hidden outline-none",
                      "transition-[width,height,border-radius,box-shadow] duration-[--motion-duration-slow] ease-[--motion-ease-emphasized]",
                      fullScreen
                        ? "h-dvh w-screen rounded-none"
                        : "h-[min(88dvh,860px)] w-[min(94vw,1180px)] rounded-[22px] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.55)] ring-1 ring-border/70",
                    )}
                  >
                    {/* A crash stays in Studio; the piece keeps being made on the server. */}
                    <WindowErrorBoundary
                      resetKey={session.id}
                      onClose={() => {
                        setExitTo("dock");
                        closeSession(session.id);
                      }}
                    >
                      <ComposerBody
                        session={session}
                        isMobile={isMobile}
                        onMinimize={() => toDock(session.id)}
                      />
                    </WindowErrorBoundary>
                  </motion.div>
                </DialogPrimitive.Content>
              </div>
            </DialogPrimitive.Portal>
          ) : null}
        </AnimatePresence>
      )}
    </DialogPrimitive.Root>
  );
}

export function ComposerBody({
  session,
  isMobile,
  fixtures,
  onMinimize,
  embedded = false,
}: {
  session: StudioSession;
  isMobile: boolean;
  fixtures?: ComposerFixtures;
  onMinimize?: () => void;
  /** On the canvas (Holo): a page, not a window, so no window buttons. */
  embedded?: boolean;
}) {
  const format = STUDIO_FORMATS[session.type];
  const [cancelling, setCancelling] = useState(false);
  // Holo: extras (ideas, templates) slide in from the right, never stack in the page.
  const [drawer, setDrawer] = useState(false);
  // The side panel runs the full height of the composer, over the header too,
  // so it is drawn into this layer rather than inside the step's page.
  const [panelHost, setPanelHost] = useState<HTMLDivElement | null>(null);
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
    if (isMobile || embedded) return;
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
    <div className="@container/composer relative flex h-full min-h-0 flex-col">
      <header
        className={cn(
          "relative z-10 flex h-16 shrink-0 select-none items-center gap-2 px-3 @3xl/composer:gap-2.5 @3xl/composer:px-5",
          // Review on a wide screen: the side panel runs the full height (Holo),
          // so the header floats over the picture side only.
          session.step === "review" &&
            "@5xl/composer:absolute @5xl/composer:left-0 @5xl/composer:right-[380px] @5xl/composer:top-0",
        )}
        onDoubleClick={(e) => {
          // Standard window behaviour: double-click empty header space to maximize.
          if ((e.target as HTMLElement).closest("button, a, input, textarea, [role='tab']")) return;
          resize();
        }}
      >
        {/* Back is always there, so nobody is ever stuck on this page. */}
        <button
          type="button"
          onClick={() => {
            // While a piece is being made (or changed), Back leaves it running
            // in the background; the corner list follows it.
            if (working || session.pendingKey) return minimize();
            // One step out: a finished piece is already in the Library.
            if (session.step === "review") return closeSession(session.id);
            // A typed brief is kept in the dock; an empty one is simply closed.
            closeSession(session.id);
            emitAppEvent("open:create-launcher", { back: session.id });
          }}
          aria-label={
            working || session.pendingKey
              ? "Back, keep making it in the background"
              : session.step === "review"
                ? "Close"
                : "Back to formats"
          }
          title={
            working || session.pendingKey
              ? "Keeps going in the background"
              : session.step === "review"
                ? "Close, it is saved in your Library"
                : "Back to formats"
          }
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] pl-2.5 pr-3.5 text-[13px] font-semibold shadow-[var(--ds-card-shadow)] transition hover:-translate-x-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 lg:min-h-9"
        >
          <ArrowLeft className="size-4" />
          <span className="hidden @3xl/composer:inline">Back</span>
        </button>
        {session.step === "intent" ? (
          <TypeSwitcher session={session} />
        ) : (
          <span className="flex shrink-0 items-center gap-2 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] py-1 pl-1 pr-3 shadow-[var(--ds-card-shadow)]">
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
            {/* line-clamp, not truncate: the narrow-screen rule in styles.css lets `truncate` wrap, and a wrapped title spills out of the header. */}
            <DialogPrimitive.Title className="line-clamp-1 break-all text-sm font-semibold tracking-tight text-foreground @4xl/composer:sr-only">
              {title}
            </DialogPrimitive.Title>
          </motion.div>
        </AnimatePresence>

        <StepIndicator
          index={stepIndex}
          working={working}
          onDescribe={
            session.step === "review" && !working ? () => backToBrief(session.id) : undefined
          }
        />

        <TooltipProvider delayDuration={300}>
          <div className="flex min-w-0 flex-1 shrink-0 items-center justify-end gap-0.5 @max-4xl/composer:flex-none">
            {embedded ? null : (
              <>
                <WindowButton
                  onClick={minimize}
                  label={working ? "Minimize — keeps going" : "Minimize"}
                >
                  <Minus />
                </WindowButton>
                {!isMobile ? (
                  <WindowButton
                    onClick={resize}
                    label={maximized ? "Exit full screen" : "Full screen"}
                  >
                    {maximized ? <Minimize2 /> : <Maximize2 />}
                  </WindowButton>
                ) : null}
                <DialogPrimitive.Close asChild>
                  <WindowButton label="Close">
                    <X />
                  </WindowButton>
                </DialogPrimitive.Close>
              </>
            )}
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
              drawerOpen={drawer}
              onDrawerChange={setDrawer}
              panelHost={panelHost}
              fixtureIdeas={fixtures?.ideas}
              onPickIdea={pickIdea}
            />
          ) : session.step === "generating" ? (
            <div className="h-full overflow-y-auto">
              <GenerationProgress
                session={session}
                cancelling={cancelling}
                onBackground={minimize}
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
      <div
        ref={setPanelHost}
        className="pointer-events-none absolute inset-0 z-30 [&>*]:pointer-events-auto"
      />
    </div>
  );
}

/** Describe → Generate → Review, with a sliding highlight on the current step. */
function StepIndicator({
  index,
  working,
  onDescribe,
}: {
  index: number;
  working: boolean;
  /** From a finished piece, the Describe pill goes back to its brief. */
  onDescribe?: () => void;
}) {
  const reduce = useReducedMotion();
  return (
    <ol
      // In the row's flow, between two flex-1 spacers: centred when there is
      // room, and never drawn over the Back and format pills when there isn't.
      className="hidden shrink-0 items-center gap-0.5 rounded-full bg-[var(--ds-well-bg)] p-1 @4xl/composer:flex"
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
            {s.id === "intent" && onDescribe ? (
              <button
                type="button"
                onClick={onDescribe}
                aria-label="Back to description"
                title="Change the description"
                className="absolute inset-0 rounded-full transition-colors hover:bg-[var(--ds-card-bg)]"
              />
            ) : null}
            {state === "current" ? (
              <motion.span
                layoutId="composer-step"
                className="absolute inset-0 rounded-full bg-[var(--ds-card-bg)] shadow-[0_4px_14px_-6px_rgb(0_0_0/0.18)]"
                transition={
                  reduce ? { duration: 0 } : { duration: duration.medium, ease: ease.emphasized }
                }
              />
            ) : null}
            <span
              className={cn(
                "relative grid size-4 place-items-center rounded-full text-[9px] font-semibold tabular-nums transition-colors duration-[--motion-duration-slow]",
                state === "done" && "bg-[var(--mox-green)] text-white",
                state === "current" && "[background:var(--mox-gradient)] text-[var(--mox-ink)]",
                state === "todo" && "text-muted-foreground ring-1 ring-border-strong",
              )}
            >
              {state === "done" ? (
                <Check className="size-2.5" strokeWidth={3.5} />
              ) : state === "current" && working && s.id === "generating" ? (
                <span className="size-1.5 animate-pulse rounded-full bg-white" />
              ) : (
                i + 1
              )}
            </span>
            <span
              className={cn(
                "relative transition-colors",
                state === "current"
                  ? "font-semibold text-foreground"
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
            "grid size-11 place-items-center rounded-full text-muted-foreground transition-colors duration-[--motion-duration-fast] hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 lg:size-8 [&_svg]:size-4",
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
          className="flex min-h-11 items-center gap-2 rounded-lg px-1.5 pr-2 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 lg:min-h-9"
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

export function IntentStep({
  session,
  isMobile,
  onPickIdea,
  fixtureIdeas,
  drawerOpen = false,
  onDrawerChange,
  panelHost,
}: {
  session: StudioSession;
  isMobile: boolean;
  onPickIdea: (idea: StudioIdea) => void;
  fixtureIdeas?: StudioIdea[];
  /** Holo's side panel: options, ideas and templates. */
  drawerOpen?: boolean;
  onDrawerChange?: (open: boolean) => void;
  /** Where the side panel is drawn: the whole composer, header included. */
  panelHost?: HTMLElement | null;
}) {
  const format = STUDIO_FORMATS[session.type];
  // Each way of starting asks for its own thing (clips, photos, a page...).
  const start = startFor(session.type, session.controls);
  const missing = missingFor(session.type, session.controls);
  const canvas = canvasPickers(session.type, session.controls);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const ready = session.brief.trim().length >= 3 && !missing;
  const busy =
    !!session.pendingKey ||
    Boolean(session.uploadingReference) ||
    (needsVideoQuote(session.type, session.controls) && !session.controls.videoQuote);
  const template = getTemplate(session.template);
  const blanks = countBlanks(session.brief);
  const hasBrand = useMemo(() => !!readBrandPayload(session.workspaceId), [session.workspaceId]);
  const writer = usePromptWriter(session);
  const media = usePromptMedia(session, !!session.pendingKey || writer.busy);

  useEffect(() => {
    if (!isMobile) textarea.current?.focus();
  }, [session.id, session.type, isMobile]);

  const submit = () => {
    if (!ready || busy || writer.busy) return;
    const id = session.id;
    // Holo: Generate hands the piece to the corner list at once and gets out
    // of the way: nobody waits on a loading page. It is made on the server;
    // the list shows it ("Starting…" until the server answers) and opens it
    // when ready. A refusal checked before sending (price still loading, a
    // photo uploading) never starts, so the page stays to say why.
    const started = generate(id, { kind: session.lastGood ? "regenerate" : "generate" });
    if (getSession(id)?.pendingKey) minimizeSession(id);
    void started.then(() => {
      const s = getSession(id);
      if (!s || (!s.error && !s.billing)) return;
      // Refused by the server (credits, plan, a bad brief): bring the page
      // back only if nothing else is open, otherwise say so with a button.
      const active = getActiveSessionId();
      if (!active || active === id) return focusSession(id);
      toast.error(s.billing ? "That piece needs more credits." : (s.error ?? "It didn't start."), {
        action: { label: "Open", onClick: () => focusSession(id) },
      });
    });
  };

  const pickAndClose = (idea: StudioIdea) => {
    onPickIdea(idea);
    onDrawerChange?.(false);
  };

  // On a desktop the extra choices live in Holo's side panel; on a phone
  // they stay in the page.
  const sidePanel = !isMobile;
  const [tab, setTab] = useState<"options" | "ideas">("options");
  const openPanel = (next: "options" | "ideas") => {
    setTab(next);
    onDrawerChange?.(true);
  };
  const goalLabel = GOALS.find((g) => g.id === session.goal)?.label;
  const options = (
    <>
      {!session.sourceScript ? (
        <div>
          <p className="mb-2 text-xs font-medium text-foreground">Goal</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Goal">
            {GOALS.map((g) => (
              <ChipButton
                key={g.id}
                selected={session.goal === g.id}
                onClick={() =>
                  updateSession(session.id, {
                    goal: session.goal === g.id ? undefined : g.id,
                  })
                }
              >
                {session.goal === g.id ? (
                  <Check className="size-3 text-primary-ink" strokeWidth={3} />
                ) : null}
                {g.label}
              </ChipButton>
            ))}
          </div>
        </div>
      ) : null}

      <ControlsPanel session={session} disabled={busy} />
    </>
  );

  // Holo's canvas: one narrow column on the canvas (the idea, then a few small
  // options), one gradient pill in the corner. Nothing is drawn before it is
  // made; ideas and templates wait in a drawer.
  return (
    <div className="relative flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
        <div className="mx-auto w-full max-w-[560px] px-5 pb-32 pt-3 @3xl/composer:pt-10">
          <div className="studio-stagger min-w-0 space-y-6">
            {session.sourceScript ? (
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Make your video</h2>
                <details className="mt-4 rounded-2xl border border-border bg-surface-3 p-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    Script used in this video
                  </summary>
                  <ScriptPreview
                    script={session.sourceScript}
                    platform={session.controls.platforms[0]}
                  />
                </details>
                {session.billing ? (
                  <UpgradePrompt block={session.billing} className="mt-3" />
                ) : session.error ? (
                  <p role="alert" className="mt-2 text-sm text-danger">
                    {session.error}
                  </p>
                ) : null}
              </div>
            ) : (
              <div>
                <label
                  htmlFor="studio-brief"
                  className="block text-center text-[24px] font-bold tracking-[-0.03em] text-foreground"
                >
                  {start ? start.lead : "Describe your"}{" "}
                  <span className="ds-grad-text">{start ? start.word : format.noun}</span>
                </label>
                {start?.steps ? (
                  <ol
                    className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground"
                    data-testid="studio-start-steps"
                  >
                    {start.steps.map((step, i) => (
                      <li key={step} className="inline-flex items-center gap-1.5">
                        <span className="grid size-5 place-items-center rounded-full bg-[var(--ds-well-bg)] text-[11px] font-bold text-foreground">
                          {i + 1}
                        </span>
                        {step}
                      </li>
                    ))}
                  </ol>
                ) : null}

                <div
                  {...media.dropProps}
                  className={cn(
                    "relative mt-5 rounded-[20px] border bg-[var(--ds-card-bg)] shadow-[var(--ds-card-shadow)] transition-[border-color,box-shadow]",
                    "focus-within:border-primary-border focus-within:shadow-[0_0_0_4px_hsl(var(--primary)/0.12),0_22px_50px_-22px_hsl(var(--primary)/0.5)]",
                    session.error ? "border-danger-border" : "border-input",
                  )}
                >
                  <WritingOverlay writer={writer} />
                  <DropHint media={media} />
                  {session.sourceContentId ? (
                    <div
                      className="flex items-center gap-2 border-b border-border px-3.5 py-2 text-xs text-muted-foreground"
                      data-testid="studio-source-strip"
                    >
                      <Repeat2 className="size-3.5 text-primary-ink" />
                      <span className="min-w-0 flex-1 truncate">
                        Made from{" "}
                        <span className="font-medium text-foreground">
                          {session.sourceLabel ?? "your piece"}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateSession(session.id, {
                            sourceContentId: undefined,
                            sourceLabel: undefined,
                          })
                        }
                        className="rounded px-1.5 py-0.5 hover:bg-surface-2 hover:text-foreground"
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}
                  {template ? (
                    <div
                      className={`studio-tone-${session.type} flex items-center gap-2 border-b border-border px-3.5 py-2 text-xs text-muted-foreground`}
                    >
                      <LayoutTemplate className="size-3.5 text-[var(--tone-ink)]" />
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
                      <Sparkles className="size-3.5 text-primary-ink" />
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
                    placeholder={start?.placeholder ?? format.placeholder}
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
                  <MediaStrip media={media} />
                  <div className="flex flex-wrap items-center gap-3 px-3 pb-3 pt-1.5 text-xs">
                    <WriteForMeButton writer={writer} />
                    <AttachButtons media={media} />
                    {!hasBrand ? (
                      <button
                        type="button"
                        onClick={() => emitAppEvent("open:brand-dna", { tab: "essentials" })}
                        className="inline-flex items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Sparkles className="size-3.5 text-primary-ink" />
                        Add Brand DNA
                      </button>
                    ) : null}
                    {blanks ? (
                      <span
                        className={`studio-tone-${session.type} ml-auto font-medium tabular-nums text-[var(--tone-ink)]`}
                      >
                        {blanks} to fill in
                      </span>
                    ) : null}
                  </div>
                </div>
                <LibraryPicker media={media} />
                <WrittenNote writer={writer} />
                {session.billing ? (
                  <UpgradePrompt block={session.billing} className="mt-3" />
                ) : session.error ? (
                  <p id="studio-brief-error" role="alert" className="mt-2 text-sm text-danger">
                    {session.error}
                  </p>
                ) : null}
              </div>
            )}

            {!session.sourceScript ? <PhotoUse media={media} /> : null}

            {/* What this start needs, on the page, not in the side panel. */}
            {canvas.source ? (
              <SourceClips
                key={session.workspaceId}
                workspaceId={session.workspaceId}
                controls={session.controls}
                set={(patch) =>
                  updateSession(session.id, { controls: { ...session.controls, ...patch } })
                }
                disabled={busy}
                fixedMode
              />
            ) : null}
            {canvas.product ? (
              <ProductPicker
                workspaceId={session.workspaceId}
                type={session.type}
                value={session.controls.productId}
                onChange={(productId) =>
                  updateSession(session.id, {
                    controls: {
                      ...session.controls,
                      productId,
                      noProduct: productId ? undefined : true,
                    },
                  })
                }
              />
            ) : null}
            {canvas.adObjective ? (
              <AdObjectivePicker
                value={session.controls.adObjective}
                onChange={(adObjective) =>
                  updateSession(session.id, { controls: { ...session.controls, adObjective } })
                }
              />
            ) : null}

            <PlatformControls session={session} disabled={busy} />

            <VideoCanvasSettings session={session} media={media} disabled={busy} />

            {sidePanel ? (
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <PanelChip
                  icon={<SlidersHorizontal />}
                  label="Options"
                  hint={goalLabel ?? "Product, goal, size"}
                  onClick={() => openPanel("options")}
                />
                {!session.sourceScript ? (
                  <PanelChip icon={<Sparkles />} label="Ideas" onClick={() => openPanel("ideas")} />
                ) : null}
              </div>
            ) : (
              <>
                {options}
                {!session.sourceScript ? (
                  <PanelChip icon={<Sparkles />} label="Ideas" onClick={() => openPanel("ideas")} />
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      {sidePanel
        ? portalInto(
            panelHost,
            <AnimatePresence>
              {!drawerOpen ? (
                <PanelHandle
                  key="studio-panel-handle"
                  marked={!!session.goal || !!session.controls.productId}
                  onOpen={() => openPanel("options")}
                />
              ) : null}
            </AnimatePresence>,
          )
        : null}

      {portalInto(
        panelHost,
        <AnimatePresence>
          {drawerOpen ? (
            <motion.div
              key="studio-panel-shade"
              aria-hidden
              onClick={() => onDrawerChange?.(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 bg-[var(--ds-canvas-bg)]/40 backdrop-blur-[6px]"
            />
          ) : null}
          {drawerOpen ? (
            <motion.aside
              key="studio-panel"
              id="studio-drawer"
              aria-label="Options and ideas"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%", transition: { duration: duration.base, ease: ease.accelerate } }}
              transition={spring.surface}
              className="absolute bottom-0 right-0 top-0 z-30 flex w-[min(100%,380px)] flex-col border-l border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] shadow-[-30px_0_80px_-40px_rgb(0_0_0/0.35)]"
            >
              <div className="flex flex-col gap-3 px-5 pb-3 pt-3.5">
                <button
                  type="button"
                  onClick={() => onDrawerChange?.(false)}
                  className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] py-1.5 pl-2.5 pr-3.5 text-[13px] font-semibold shadow-[var(--ds-card-shadow)] transition hover:-translate-x-0.5"
                >
                  <ArrowLeft className="size-4" />
                  Back
                </button>
                {!session.sourceScript ? (
                  <div
                    role="tablist"
                    aria-label="Panel"
                    className="grid grid-cols-2 rounded-full bg-[var(--ds-well-bg)] p-1"
                  >
                    {(["options", "ideas"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="tab"
                        aria-selected={tab === t}
                        onClick={() => setTab(t)}
                        className="relative h-8 rounded-full text-[13px] font-semibold"
                      >
                        {tab === t ? (
                          <motion.span
                            layoutId="studio-panel-tab"
                            className="absolute inset-0 rounded-full bg-[var(--ds-card-bg)] shadow-[0_4px_14px_-6px_rgb(0_0_0/0.18)]"
                          />
                        ) : null}
                        <span
                          className={cn(
                            "relative",
                            tab === t ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {t === "options" ? "Options" : "Ideas"}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 pb-5 [scrollbar-width:thin]">
                {tab === "ideas" && !session.sourceScript ? (
                  <>
                    <IdeasPanel
                      workspaceId={session.workspaceId}
                      type={session.type}
                      selectedId={session.ideaId}
                      onPick={pickAndClose}
                      limit={4}
                      fixtureIdeas={fixtureIdeas}
                    />
                    <TemplateGallery session={session} textareaRef={textarea} title="Templates" />
                  </>
                ) : sidePanel ? (
                  options
                ) : null}
              </div>
              <div className="px-5 pb-5 pt-2">
                <Button
                  onClick={() => onDrawerChange?.(false)}
                  size="lg"
                  className="studio-cta w-full rounded-full"
                >
                  Done
                </Button>
              </div>
            </motion.aside>
          ) : null}
        </AnimatePresence>,
      )}

      {/* Holo: the price and one gradient pill float in the corner. */}
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-end gap-3 px-4 pb-4 @3xl/composer:px-6 @3xl/composer:pb-5">
        <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)]/85 p-1.5 pl-3 shadow-[0_18px_40px_-20px_rgb(0_0_0/0.35)] backdrop-blur-xl">
          {missing ? (
            <span
              role="status"
              className="text-xs font-semibold text-foreground"
              data-testid="studio-missing"
            >
              {missing}
            </span>
          ) : null}
          <StudioPrice session={session} />
          <Button
            onClick={submit}
            disabled={!ready || busy || writer.busy}
            size="lg"
            className="studio-cta rounded-full px-6"
          >
            {busy ? <Spinner className="animate-spin" aria-hidden /> : <Wand2 />}
            {session.uploadingReference
              ? "Uploading photo…"
              : busy
                ? "Starting…"
                : needsStoryboard({ type: session.type, controls: session.controls })
                  ? "Plan the storyboard"
                  : session.lastGood
                    ? "Generate again"
                    : "Generate"}
          </Button>
        </div>
      </footer>
    </div>
  );
}

/** Draw into `host` when it exists (the composer's full-height layer), else in place. */
function portalInto(host: HTMLElement | null | undefined, node: React.ReactNode) {
  return host ? createPortal(node, host) : node;
}

/**
 * Holo's side-panel handle: a slim tab centred on the canvas's right edge.
 * It opens the options panel from wherever the person is on the page, and
 * carries a dot when something is already set inside (a goal, a product).
 */
function PanelHandle({ marked, onOpen }: { marked: boolean; onOpen: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12, transition: { duration: duration.fast } }}
      transition={spring.surface}
      style={{ y: "-50%" }}
      className="absolute right-0 top-1/2 z-20"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label="Open options and ideas"
        aria-controls="studio-drawer"
        title="Options and ideas"
        className={cn(
          "group relative flex h-14 w-7 items-center justify-center rounded-l-2xl border border-r-0 border-[var(--ds-card-border)] bg-[var(--ds-card-bg)]/90 text-muted-foreground shadow-[-10px_0_30px_-16px_rgb(0_0_0/0.35)] backdrop-blur-xl transition-[width,color] duration-200 hover:w-9 hover:text-foreground focus-visible:w-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55",
          marked && "panel-handle-nudge",
        )}
      >
        <ChevronLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
        {marked ? (
          <span
            aria-hidden
            className="absolute right-1.5 top-2 size-1.5 rounded-full [background:var(--mox-gradient)]"
          />
        ) : null}
      </button>
    </motion.div>
  );
}

/** A small pill on the canvas that opens the side panel on one tab. */
function PanelChip({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex h-10 items-center gap-2 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] pl-3 pr-4 text-[13px] font-semibold text-foreground shadow-[var(--ds-card-shadow)] transition hover:-translate-y-px [&_svg]:size-4 [&_svg]:text-[var(--mox-green)]"
    >
      {icon}
      {label}
      {hint ? <span className="font-medium text-muted-foreground">· {hint}</span> : null}
    </button>
  );
}

/** The price of the next Generate, from the same rule the server charges by. */
function StudioPrice({ session }: { session: StudioSession }) {
  const [quoteError, setQuoteError] = useState(false);
  // A product the brief names is picked here too, and its photos priced in.
  const product = useBriefProduct(session);
  const controls = withProductPhotos(session, product);
  const { videoMode, recapMotion } = session.controls;
  // Same rule Generate waits on: own footage and recaps are never quoted.
  const quotedVideo = needsVideoQuote(session.type, session.controls);
  const quoteSignature = JSON.stringify([
    session.controls.videoModelKey,
    session.controls.durationSec,
    session.controls.videoResolution,
    session.controls.referenceAssetIds,
  ]);
  useEffect(() => {
    if (!quotedVideo || session.controls.videoQuote) return;
    let cancelled = false;
    setQuoteError(false);
    const timer = setTimeout(() => {
      void studioApi
        .videoQuote(session.workspaceId, session.controls, {
          brief: session.brief,
          template: session.template,
          source: { picture: !!session.sourceContentId, script: !!session.sourceScript },
        })
        .then((videoQuote) => {
          const latest = getSession(session.id);
          if (!cancelled && latest)
            updateSession(session.id, { controls: { ...latest.controls, videoQuote } });
        })
        .catch(() => {
          if (!cancelled) setQuoteError(true);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // The quote is invalidated only by settings that change the provider price.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, quotedVideo, quoteSignature, session.controls.videoQuote?.hash]);
  // A long or premium video is made as its storyboard first: Generate costs
  // the storyboard; the video's own price shows on the storyboard's Create.
  if (needsStoryboard({ type: session.type, controls: session.controls }))
    return session.controls.paymentSource === "creation" ? (
      <span
        data-slot="cost-chip"
        className="ml-auto shrink-0 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground"
      >
        Storyboard ·{" "}
        {studioPriceLabel({
          type: session.type,
          controls: withStoryboard(session.type, session.controls),
        })}
      </span>
    ) : (
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Storyboard</span>
        <CostChip announce action="video_storyboard" />
      </span>
    );
  if (quotedVideo)
    return (
      <span data-slot="cost-chip" className="ml-auto text-xs text-muted-foreground">
        {session.controls.videoQuote
          ? `${studioPriceLabel({ type: session.type, controls: session.controls })} · ${session.controls.videoQuote.resolution ?? ""} ${session.controls.videoQuote.aspectRatio ?? ""}`
          : quoteError
            ? "Choose another video option"
            : "Checking price…"}
      </span>
    );
  if (session.controls.paymentSource === "creation")
    return (
      <span
        data-slot="cost-chip"
        className="ml-auto shrink-0 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground"
      >
        {studioPriceLabel({
          type: session.type,
          controls: session.controls,
          intent: { brief: session.brief },
        })}
      </span>
    );
  // Words asked for on a kept photo make it a photo design: price what runs.
  const referenceMode = resolvePhotoMode({
    type: session.type,
    controls,
    intent: { brief: session.brief },
  });
  const charge = studioChargeFor({
    type: session.type,
    includeImage: session.controls.includeImage,
    length: session.controls.length,
    storyMode: session.controls.storyMode,
    videoPreview: session.controls.videoPreview,
    regenerate: Boolean(session.lastGood),
    referenceMode,
    referenceAssetIds: controls.referenceAssetIds,
    photoFidelity: controls.photoFidelity,
    articleQuality: session.controls.articleQuality,
    videoMode,
    recapMotion,
    videoModelKey: session.controls.videoModelKey,
    durationSec: session.controls.durationSec,
    videoResolution: session.controls.videoResolution,
  });
  const clip = charge === "studio_short_clip" ? shortClipPlan({ ...session, controls }) : null;
  if (clip)
    return (
      <CostChip announce credits={shortClipPrice(clip).credits} className="ml-auto shrink-0" />
    );
  return charge === "studio_video" ? (
    <CostChip
      announce
      videoUnits={studioVideoUnits(
        // Animated recap photos are five seconds each, whatever length was picked.
        videoMode === "recap"
          ? (session.controls.referenceAssetIds?.length ?? 0) * RECAP_AI_SECONDS
          : session.controls.durationSec,
      )}
      className="ml-auto shrink-0"
    />
  ) : (
    <CostChip announce action={charge as CreditAction} className="ml-auto shrink-0" />
  );
}
