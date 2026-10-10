"use client";

// AppTour — the look around the app a new person gets, once.
//
// Presentational: it is given the stops (src/lib/tour/steps.ts) and finds each
// one's control on the page by its `data-tour` name. The page behind is dimmed
// and cannot be clicked; the control a stop is about is lit. A stop whose
// control isn't on screen is shown centred, so a layout change never breaks
// the tour. It starts nothing and saves nothing by itself: the last card's
// buttons are a person's own click, handed to `onClose`.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Logo } from "@/components/brand/Logo";
import { BrainIcon } from "@/components/app/brain/BrainMark";
import { dsGhostBtn, dsIconBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Bot,
  CalendarIcon,
  Check,
  MessageCircle,
  PanelRightOpen,
  Settings,
  Share2,
  Sparkles,
  Wand,
  X,
  type LucideIcon,
} from "@/components/icons";
import {
  TOUR_FINISH,
  placeCard,
  type TourFinishAction,
  type TourIcon,
  type TourRect,
  type TourStop,
} from "@/lib/tour/steps";
import { cn } from "@/lib/utils";

const ICONS: Record<TourIcon, LucideIcon> = {
  chat: MessageCircle,
  autopilot: Bot,
  studio: PanelRightOpen,
  library: BookOpen,
  brain: BrainIcon,
  analytics: BarChart3,
  calendar: CalendarIcon,
  visibility: Sparkles,
  settings: Settings,
  share: Share2,
};

/** Room between a lit control and the edge of its light. */
const HALO = 6;

type Lit = { rect: TourRect; radius: number };
type Scene = { lit: Lit | null; vw: number; vh: number };

/** The first control with one of these names that is really drawn. */
function findAnchor(names: string[]): HTMLElement | null {
  for (const name of names) {
    const found = document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`);
    for (const el of found) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

function sameScene(a: Scene, b: Scene): boolean {
  if (a.vw !== b.vw || a.vh !== b.vh || !a.lit !== !b.lit) return false;
  if (!a.lit || !b.lit) return true;
  const [x, y] = [a.lit.rect, b.lit.rect];
  return (
    Math.abs(x.left - y.left) < 0.5 &&
    Math.abs(x.top - y.top) < 0.5 &&
    Math.abs(x.width - y.width) < 0.5 &&
    Math.abs(x.height - y.height) < 0.5 &&
    a.lit.radius === b.lit.radius
  );
}

export function AppTour({
  stops,
  name,
  initialStep = -1,
  onStop,
  onClose,
}: {
  stops: TourStop[];
  /** The person's first name, for the welcome. */
  name?: string;
  /** -1 is the welcome, `stops.length` the last card. */
  initialStep?: number;
  /** The stop now showing (null on the welcome and the last card). */
  onStop?: (stop: TourStop | null) => void;
  /** Closed: skipped, finished, or one of the last card's first steps. */
  onClose: (action?: TourFinishAction) => void;
}) {
  const [step, setStep] = useState(initialStep);
  const [scene, setScene] = useState<Scene>({ lit: null, vw: 0, vh: 0 });
  const [cardSize, setCardSize] = useState<{ width: number; height: number } | null>(null);
  // The card appears in place; only later moves are animated.
  const [settled, setSettled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);

  const stop = step >= 0 && step < stops.length ? stops[step] : null;
  const phase = step < 0 ? "welcome" : stop ? "stop" : "finish";
  const anchors = stop?.anchors;

  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    returnFocus.current = document.activeElement;
    setMounted(true);
    return () => {
      const el = returnFocus.current;
      if (el instanceof HTMLElement && el.isConnected) el.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    onStopRef.current?.(stop);
  }, [stop]);

  // Follow the lit control every frame: sidebars slide, windows resize. It is
  // also read at once and on a slow timer, because a window that isn't being
  // drawn gets no frames.
  useEffect(() => {
    let frame = 0;
    let broughtIntoView: HTMLElement | null = null;
    let radiusOf: HTMLElement | null = null;
    let radius = 0;
    const measure = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const el = anchors ? findAnchor(anchors) : null;
      let lit: Lit | null = null;
      if (el) {
        let r = el.getBoundingClientRect();
        const off = r.bottom > vh || r.top < 0;
        if (off && broughtIntoView !== el) {
          broughtIntoView = el;
          el.scrollIntoView({ block: "center", inline: "nearest" });
          r = el.getBoundingClientRect();
        }
        if (radiusOf !== el) {
          radiusOf = el;
          radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
        }
        const onScreen = r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
        if (onScreen) {
          const height = r.height + HALO * 2;
          lit = {
            rect: {
              left: r.left - HALO,
              top: r.top - HALO,
              width: r.width + HALO * 2,
              height,
            },
            radius: Math.min(radius + HALO, height / 2),
          };
        }
      }
      const next: Scene = { lit, vw, vh };
      setScene((current) => (sameScene(current, next) ? current : next));
    };
    const tick = () => {
      measure();
      frame = requestAnimationFrame(tick);
    };
    measure();
    frame = requestAnimationFrame(tick);
    const timer = window.setInterval(measure, 250);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, [anchors]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const measure = () =>
      setCardSize((current) =>
        current?.width === card.offsetWidth && current.height === card.offsetHeight
          ? current
          : { width: card.offsetWidth, height: card.offsetHeight },
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, [mounted]);

  const placed = cardSize && scene.vw > 0;
  useEffect(() => {
    if (!placed) return;
    const timer = window.setTimeout(() => setSettled(true), 60);
    return () => window.clearTimeout(timer);
  }, [placed]);

  // Each card takes focus as it arrives, so the keyboard and a screen reader
  // are on the tour and not on the page behind it.
  useEffect(() => {
    if (!mounted) return;
    const timer = window.setTimeout(() => cardRef.current?.focus({ preventScroll: true }), 40);
    return () => window.clearTimeout(timer);
  }, [mounted, step]);

  const last = stops.length;
  const go = (to: number) => setStep(Math.max(-1, Math.min(to, last)));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const card = cardRef.current;
      if (!card) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setStep((current) => Math.min(current + 1, last));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setStep((current) => Math.max(current - 1, -1));
      } else if (event.key === "Tab") {
        // Keep the keyboard inside the card.
        const items = Array.from(card.querySelectorAll<HTMLElement>("button:not([disabled])"));
        if (!items.length) return;
        const at = items.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        const next = event.shiftKey
          ? at <= 0
            ? items.length - 1
            : at - 1
          : at === items.length - 1
            ? 0
            : at + 1;
        items[next].focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [last]);

  if (!mounted) return null;

  const lit = stop ? scene.lit : null;
  const position = placed
    ? placeCard(
        lit?.rect ?? null,
        cardSize,
        { width: scene.vw, height: scene.vh },
        stop?.side ?? "top",
      )
    : null;
  const hole = lit?.rect ?? {
    left: scene.vw / 2,
    top: scene.vh / 2,
    width: 0,
    height: 0,
  };
  const move = settled
    ? "transition-[transform,opacity] duration-300 ease-[var(--ds-ease)] motion-reduce:transition-none"
    : "";
  const titleId = `tour-title-${phase === "stop" ? stop?.id : phase}`;
  const Icon = stop ? ICONS[stop.icon] : null;

  return createPortal(
    <div
      data-mellox-app
      data-testid="app-tour"
      data-step={phase === "stop" ? stop?.id : phase}
      data-lit={lit ? "true" : "false"}
      className="fixed inset-0 z-[90] text-foreground"
    >
      {/* Nothing behind the tour can be clicked while it shows. */}
      <div aria-hidden className="absolute inset-0" />

      {/* One box: its shadow is the dim, the box itself is the light. */}
      <div
        aria-hidden
        data-testid="tour-light"
        className={cn(
          "pointer-events-none absolute",
          settled &&
            "transition-[left,top,width,height,border-radius,box-shadow] duration-300 ease-[var(--ds-ease)] motion-reduce:transition-none",
        )}
        style={{
          left: hole.left,
          top: hole.top,
          width: hole.width,
          height: hole.height,
          borderRadius: lit ? lit.radius : 0,
          boxShadow: `0 0 0 2px hsl(var(--primary) / ${lit ? 0.9 : 0}), 0 0 28px 4px hsl(var(--primary) / ${lit ? 0.28 : 0}), 0 0 0 200vmax rgb(0 0 0 / 0.6)`,
        }}
      />

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "ds-window ds-glow absolute left-0 top-0 max-h-[calc(100dvh-24px)] overflow-y-auto outline-none",
          phase === "stop" ? "w-[min(360px,calc(100vw-24px))]" : "w-[min(440px,calc(100vw-24px))]",
          move,
        )}
        style={{
          transform: position ? `translate3d(${position.left}px, ${position.top}px, 0)` : undefined,
          opacity: position ? 1 : 0,
        }}
      >
        {phase === "welcome" && (
          <div
            key="welcome"
            className="ds-enter flex flex-col items-center px-6 pb-6 pt-8 text-center"
          >
            <span className="grid h-14 w-14 place-items-center rounded-full bg-primary/12 ring-1 ring-primary/25">
              <Logo markOnly height={30} />
            </span>
            <h2 id={titleId} className="mt-4 text-[20px] font-semibold tracking-tight">
              Welcome to Mellox{name ? `, ${name}` : ""}
            </h2>
            <p className="mt-2 max-w-[340px] text-[14px] leading-relaxed text-muted-foreground">
              Mellox learns your brand, makes your marketing and helps people find you. Take a
              one-minute look around.
            </p>
            <div className="mt-5 grid w-full grid-cols-3 gap-2">
              {(
                [
                  [Wand, "Create"],
                  [CalendarIcon, "Plan"],
                  [BarChart3, "Grow"],
                ] as const
              ).map(([PillarIcon, label]) => (
                <div
                  key={label}
                  className="ds-tile flex flex-col items-center gap-1.5 px-2 py-3 text-[12.5px] font-medium"
                >
                  <PillarIcon className="h-[18px] w-[18px] text-primary" aria-hidden />
                  {label}
                </div>
              ))}
            </div>
            <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={() => go(0)}
                className={cn(dsPrimaryBtn, "h-10 flex-1 px-5 text-[13.5px]")}
              >
                Start the tour
                <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => onClose()}
                className={cn(dsGhostBtn, "h-10 flex-1 px-5 text-[13.5px]")}
              >
                Skip
              </button>
            </div>
            <p className="mt-4 text-[12px] text-muted-foreground">
              You can take it again from your account menu.
            </p>
          </div>
        )}

        {phase === "stop" && stop && Icon && (
          <div className="p-5">
            <div className="flex items-center justify-between">
              <span
                data-testid="tour-count"
                className="text-[11.5px] font-medium tabular-nums text-muted-foreground"
              >
                {step + 1} of {stops.length}
              </span>
              <button
                type="button"
                onClick={() => onClose()}
                aria-label="Close the tour"
                className={cn(dsIconBtn, "-mr-1.5 -mt-1.5")}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div key={stop.id} className="ds-enter" aria-live="polite">
              <div className="mt-2 flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <h2
                  id={titleId}
                  className="text-[16.5px] font-semibold leading-snug tracking-tight"
                >
                  {stop.title}
                </h2>
              </div>
              <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
                {stop.body}
              </p>
              {stop.tip && (
                <p className="ds-well mt-3 px-3 py-2 text-[12.5px] leading-snug text-foreground/80">
                  {stop.tip}
                </p>
              )}
            </div>
            <div className="mt-5 flex items-center gap-2">
              <span className="flex flex-1 items-center gap-1" aria-hidden>
                {stops.map((s, i) => (
                  <span
                    key={s.id}
                    className={cn(
                      "h-1.5 rounded-full transition-all duration-300 ease-[var(--ds-ease)]",
                      i === step ? "w-4 bg-primary" : "w-1.5",
                      i < step && "bg-primary/45",
                      i > step && "bg-foreground/15",
                    )}
                  />
                ))}
              </span>
              <button
                type="button"
                onClick={() => go(step - 1)}
                className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => go(step + 1)}
                className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
              >
                {step === stops.length - 1 ? "Finish" : "Next"}
              </button>
            </div>
          </div>
        )}

        {phase === "finish" && (
          <div key="finish" className="ds-enter flex flex-col px-6 pb-6 pt-8">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary/12 text-primary ring-1 ring-primary/25">
              <Check className="h-6 w-6" aria-hidden />
            </span>
            <h2 id={titleId} className="mt-4 text-center text-[20px] font-semibold tracking-tight">
              You&apos;re ready
            </h2>
            <p className="mt-2 text-center text-[14px] text-muted-foreground">Pick a first step.</p>
            <div className="mt-5 flex flex-col gap-2">
              {TOUR_FINISH.map((action) => {
                const ActionIcon = ICONS[action.icon];
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => onClose(action.id)}
                    className="ds-tile ds-tile-hover group flex items-center gap-3 px-3.5 py-3 text-left text-[13.5px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
                      <ActionIcon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">{action.label}</span>
                    <ArrowRight
                      className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                      aria-hidden
                    />
                  </button>
                );
              })}
            </div>
            <div className="mt-5 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => go(step - 1)}
                className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => onClose()}
                className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
