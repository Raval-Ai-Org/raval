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
  FileText,
  Inbox,
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
import { PLATFORMS } from "@/lib/social-platforms";
import { RATIOS } from "@/lib/studio/aspect";
import { readBrandPayload } from "@/lib/studio/client";
import { isStudioType, STUDIO_FORMATS, type StudioType } from "@/lib/studio/formats";
import type { StudioIdea } from "@/lib/studio/ideas";
import { GOALS } from "@/lib/studio/jobs";
import {
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
import { ControlsPanel, describeControls } from "./ControlsPanel";
import { GenerationProgress } from "./GenerationProgress";
import { IdeasPanel } from "./IdeasPanel";
import { ReviewPanel, type ReviewRow } from "./ReviewPanel";
import { StartStep } from "./StartStep";
import { ChipButton, RatioFrame, TypeGlyph } from "./studio-ui";
import { TypePicker } from "./TypePicker";

const STEPS = [
  { id: "start", label: "Format" },
  { id: "intent", label: "Brief" },
  { id: "generating", label: "Create" },
  { id: "review", label: "Review" },
] as const;

/** Preview/testing data so the composer can render without a signed-in workspace. */
export type ComposerFixtures = { ideas?: StudioIdea[]; rows?: ReviewRow[]; distribution?: boolean };

function lastUsedType(): StudioType | null {
  try {
    const v = localStorage.getItem("studio:last-type");
    return isStudioType(v) ? v : null;
  } catch {
    return null;
  }
}

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

  return (
    <DialogPrimitive.Root
      open={!!session}
      onOpenChange={(v) => {
        if (!v && session) closeSession(session.id);
      }}
    >
      <AnimatePresence>
        {session ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-50 bg-background/70 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: duration.base }}
              />
            </DialogPrimitive.Overlay>
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
                initial={{ opacity: 0, y: 12, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{
                  opacity: 0,
                  y: 24,
                  scale: 0.97,
                  transition: { duration: duration.base, ease: ease.accelerate },
                }}
                transition={spring.surface}
                className={cn(
                  "fixed z-50 flex flex-col overflow-hidden bg-surface-3 shadow-4 outline-none",
                  isMobile
                    ? "inset-0"
                    : session.window === "maximized"
                      ? "inset-3 rounded-2xl border border-border"
                      : "left-1/2 top-1/2 h-[min(90vh,880px)] w-[min(95vw,1240px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border",
                )}
              >
                <ComposerBody session={session} isMobile={isMobile} />
              </motion.div>
            </DialogPrimitive.Content>
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
}: {
  session: StudioSession;
  isMobile: boolean;
  fixtures?: ComposerFixtures;
}) {
  const format = STUDIO_FORMATS[session.type];
  const [cancelling, setCancelling] = useState(false);
  const stepIndex = STEPS.findIndex((s) => s.id === session.step);
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
    <>
      <header className="flex min-h-14 items-center gap-2 border-b border-border px-3 md:px-4">
        {session.step === "review" && !session.pendingKey ? (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => backToBrief(session.id)}
            aria-label="Back to brief"
            title="Back to brief"
          >
            <ArrowLeft />
          </Button>
        ) : null}
        {session.step === "start" ? (
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </span>
        ) : session.step === "intent" ? (
          <TypeSwitcher session={session} />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <TypeGlyph type={session.type} size="sm" />
            <span className="hidden text-xs text-muted-foreground sm:inline">{format.label}</span>
          </div>
        )}
        <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-foreground">
          {title}
        </DialogPrimitive.Title>

        <ol className="mr-2 hidden items-center gap-1 lg:flex" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              className="flex items-center gap-1"
              aria-current={i === stepIndex ? "step" : undefined}
            >
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors",
                  i === stepIndex
                    ? "bg-primary-surface font-medium text-foreground ring-1 ring-primary-border"
                    : i < stepIndex
                      ? "text-foreground/70"
                      : "text-muted-foreground/60",
                )}
              >
                {i < stepIndex ? <Check className="size-3 text-primary" strokeWidth={3} /> : null}
                {s.label}
              </span>
              {i < STEPS.length - 1 ? <span aria-hidden className="h-px w-3 bg-border" /> : null}
            </li>
          ))}
        </ol>

        <div className="flex items-center gap-0.5">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => minimizeSession(session.id)}
            aria-label="Minimize"
            title="Minimize — keeps working"
          >
            <Minus />
          </Button>
          {!isMobile ? (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => toggleMaximize(session.id)}
              aria-label={session.window === "maximized" ? "Restore size" : "Maximize"}
              title={session.window === "maximized" ? "Restore size" : "Maximize"}
            >
              {session.window === "maximized" ? <Minimize2 /> : <Maximize2 />}
            </Button>
          ) : null}
          <DialogPrimitive.Close asChild>
            <Button size="icon-sm" variant="ghost" aria-label="Close" title="Close">
              <X />
            </Button>
          </DialogPrimitive.Close>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={session.step}
            className="absolute inset-0 overflow-hidden"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: duration.medium, ease: ease.emphasized }}
          >
            {session.step === "start" ? (
              <StartStep
                workspaceId={session.workspaceId}
                lastType={typeof window !== "undefined" ? lastUsedType() : null}
                fixtureIdeas={fixtures?.ideas}
                onPickIdea={pickIdea}
                onPickType={(type) => {
                  rememberStudioType(type);
                  chooseType(session.id, type);
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
                  onMinimize={() => minimizeSession(session.id)}
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
        </AnimatePresence>
      </div>
    </>
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

/** What the brief will produce — so settings never feel abstract. */
function OutputSummary({ session }: { session: StudioSession }) {
  const format = STUDIO_FORMATS[session.type];
  const c = session.controls;
  const showsMedia =
    format.media === "image" ||
    format.media === "video" ||
    (format.media === "optional-image" && c.includeImage) ||
    session.type === "carousel";
  const ratio = c.ratio ?? format.ratios[0];

  return (
    <section
      data-no-rhythm
      aria-label="What you'll get"
      className="rounded-2xl border border-border bg-surface-3 p-4"
    >
      <p className="ui-eyebrow">You'll get</p>
      <div className="mt-3 flex items-start gap-3">
        <div className="w-24 shrink-0">
          {showsMedia && ratio ? (
            <RatioFrame
              ratio={ratio}
              maxHeight={120}
              className="rounded-lg bg-surface-2 ring-1 ring-border"
            >
              <span className="absolute inset-0 grid place-items-center text-[10px] font-medium text-muted-foreground">
                {ratio}
              </span>
            </RatioFrame>
          ) : (
            <div className="grid aspect-[3/4] place-items-center rounded-lg bg-surface-2 ring-1 ring-border">
              <FileText className="size-5 text-muted-foreground" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{format.label}</p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            {describeControls(session)}
          </p>
          {c.platforms.length ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {c.platforms.map((p) => {
                const Icon = PLATFORMS[p].icon;
                return (
                  <span
                    key={p}
                    title={PLATFORMS[p].label}
                    className="grid size-6 place-items-center rounded-md bg-surface-2 ring-1 ring-border"
                  >
                    <Icon className="size-3.5" />
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
      <ul className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs text-muted-foreground [&_li]:text-xs [&_li]:leading-5">
        {c.platforms.length > 1 ? (
          <li className="flex items-center gap-2">
            <Check className="size-3.5 text-primary" />
            {c.platforms.length} native versions, one per platform
          </li>
        ) : null}
        {showsMedia && ratio && format.media !== "none" ? (
          <li className="flex items-center gap-2">
            <Check className="size-3.5 text-primary" />
            {session.type === "video"
              ? "Video"
              : session.type === "carousel"
                ? "Designed slides"
                : "Visual"}{" "}
            sized {RATIOS[ratio].label.toLowerCase()} {ratio}
          </li>
        ) : null}
        <li className="flex items-center gap-2">
          <Clock className="size-3.5" />
          {format.estimate}
        </li>
        <li className="flex items-center gap-2">
          <Inbox className="size-3.5" />
          Waits in Needs Approval
        </li>
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
      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:overflow-hidden">
        <div className="p-5 md:p-8 lg:overflow-y-auto">
          <div className="mx-auto max-w-2xl space-y-6">
            <div>
              <label
                htmlFor="studio-brief"
                className="block text-xl font-semibold tracking-tight text-foreground"
              >
                What should this {format.noun} achieve?
              </label>
              <p className="mt-1 text-sm text-muted-foreground">
                One or two sentences is enough — Mellox brings your brand, audience and what you've
                posted recently.
              </p>

              <div
                className={cn(
                  "mt-4 rounded-2xl border bg-surface-3 shadow-1 transition-[border-color,box-shadow]",
                  "focus-within:border-primary-border focus-within:shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]",
                  session.error ? "border-danger-border" : "border-input",
                )}
              >
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
                  className="block w-full resize-none !border-0 !bg-transparent px-3.5 pt-3 text-base leading-relaxed text-foreground !shadow-none outline-none placeholder:text-muted-foreground focus-visible:!ring-0 md:text-[15px]"
                />
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
                    {session.brief.length > 3500 ? `${session.brief.length}/4000` : null}
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

            <ControlsPanel session={session} disabled={busy} />

            <div className="lg:hidden">
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

        <aside className="hidden flex-col gap-6 border-l border-border bg-surface-1 p-5 lg:flex lg:overflow-y-auto">
          <OutputSummary session={session} />
          <IdeasPanel
            workspaceId={session.workspaceId}
            type={session.type}
            selectedId={session.ideaId}
            onPick={onPickIdea}
            fixtureIdeas={fixtureIdeas}
          />
        </aside>
      </div>

      <footer className="flex items-center gap-3 border-t border-border bg-surface-3 px-4 py-3 md:px-6">
        {!session.job && !session.lastGood ? (
          <Button variant="ghost" size="sm" onClick={() => backToStart(session.id)}>
            <ArrowLeft />
            <span className="hidden sm:inline">Formats</span>
          </Button>
        ) : null}
        <p className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground md:block">
          Nothing is published without your approval.
        </p>
        <div className="ml-auto flex items-center gap-3">
          <kbd className="hidden items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground ring-1 ring-border md:inline-flex">
            {isMac ? "⌘" : "Ctrl"} ↵
          </kbd>
          <Button onClick={submit} disabled={!ready || busy} size="lg">
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
