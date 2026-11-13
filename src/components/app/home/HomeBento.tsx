"use client";

// Home (Mellox 2.0, ADR-0044), Holo style: straight into a bento of cards and
// the real message box docked under it (ChatPanel keeps the box). Every card
// opens an existing place; nothing here starts paid work by itself.

import { useEffect, useRef, type CSSProperties, type ReactNode, type PointerEvent } from "react";
import { CardArrow } from "@/components/app/surface/MoxParts";
import { PlanLock } from "@/components/app/billing/billing-ui";
import type { StudioType } from "@/lib/studio/formats";
import { emitAppEvent } from "@/lib/app-events";
import { celebrate } from "@/lib/celebrate";
import type { WorkspacePulse } from "@/lib/pulse/pulse";
import { cn } from "@/lib/utils";
import { Illustration, type IlloKind } from "./illustrations";
import { StartHereCard, type StartHereView } from "./StartHere";
import { HomeExplore, type HomeCreate, type HomeCreateChoice } from "./HomeExplore";
import type { BrainOverview } from "@/lib/brain/brain";
import { rightNow } from "@/lib/home/explore";

/**
 * Holo's "Most popular" row: what people bring (a picture, their clips) and
 * the formats they reach for. Each opens an existing place; nothing is made
 * until Generate.
 */
const POPULAR: {
  id: string;
  choice: HomeCreateChoice | "animate";
  label: string;
  line: string;
  illo: IlloKind;
  /** A creator's face instead of the illustration. */
  photo?: string;
  isNew?: boolean;
  /** Where the composer starts (a video kind or the person's own clips). */
  controls?: { videoMode?: "brand"; videoKind?: "product-motion" };
}[] = [
  {
    id: "creator",
    choice: "ugc",
    label: "Creator video",
    line: "A creator talks up your product",
    illo: "video",
    photo: "/creators/amara.jpg",
  },
  {
    id: "product",
    choice: "video",
    label: "Product video",
    line: "Your product, animated",
    illo: "poster",
    controls: { videoKind: "product-motion" },
  },
  {
    id: "animate",
    choice: "animate",
    label: "Animate",
    line: "Turn pictures into videos",
    illo: "animate",
    isNew: true,
  },
  {
    id: "clips",
    choice: "video",
    label: "Your clips",
    line: "Footage in, video out",
    illo: "versions",
    isNew: true,
    controls: { videoMode: "brand" },
  },
  {
    id: "carousel",
    choice: "carousel",
    label: "Carousel",
    line: "Swipe-through story",
    illo: "carousel",
  },
];

/** A card that leans toward the pointer (up to 4°) on devices that hover. */
function TiltCard({
  children,
  className,
  style,
  onClick,
  label,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick: () => void;
  /** Pointer or focus arrived: load what the click will need. */
  label: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(700px) rotateX(${(-y * 4).toFixed(2)}deg) rotateY(${(x * 4).toFixed(2)}deg) translateY(-2px)`;
  };
  const leave = () => {
    if (ref.current) ref.current.style.transform = "";
  };
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      onClick={onClick}
      onPointerMove={move}
      onPointerLeave={leave}
      style={style}
      className={cn(
        "ds-card ds-card-hover ds-rise group flex flex-col items-start text-left will-change-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        className,
      )}
    >
      {children}
    </button>
  );
}

const rise = (i: number) => ({ ["--i" as string]: i }) as CSSProperties;

/** Presentational: ChatPanel wires it, `/home-lab` renders it with sample data. */
export function HomeBento({
  start,
  create,
  onSwipe,
  autopilot,
  brain,
  onAsk,
  onCommunities,
  pulse,
  onOpenWaiting,
}: {
  /** Opens the idea deck (any format, or blog topics). */
  onSwipe?: (type?: StudioType) => void;
  start: StartHereView;
  /** Kept for callers; Home has no greeting any more (Holo). */
  name?: string | null;
  /** What is happening now (free read): the strip on top and Ask Mox. */
  pulse?: WorkspacePulse | null | undefined;
  /** Opens the place where the waiting posts are. */
  onOpenWaiting?: () => void;
  /** `useOpenCreate()`: starts a format, or says which plan it needs. */
  create: HomeCreate;
  /** The free Brain overview: real lines on the brain tiles. */
  brain?: BrainOverview | null;
  /** Puts a question in the message box (never sends it). */
  onAsk?: (text: string) => void;
  /** Opens the Reddit agent (a route). */
  onCommunities?: () => void;
  /** Kept for callers; the cards replace the "Try" ideas. */
  starters?: ReactNode;
  /** Home's Autopilot area (HomeAutopilot), under the top cards. */
  autopilot?: ReactNode;
}) {
  // Confetti only when Start here finishes while you watch, never on load.
  const wasComplete = useRef(start.complete);
  useEffect(() => {
    if (start.complete && !wasComplete.current) celebrate();
    wasComplete.current = start.complete;
  }, [start.complete]);

  return (
    <div className="mx-auto w-full max-w-[1040px] px-4 pb-6 pt-4 md:px-8 md:pt-8">
      {/* Columns follow the canvas, not the window: with the Studio rail open
          the canvas is narrow, and three squeezed columns broke words apart. */}
      <div className="@container">
        <RightNow pulse={pulse} onOpenWaiting={onOpenWaiting} />
        {/* Bento */}
        <div className="grid grid-cols-1 gap-[14px] @xl:grid-cols-2">
          {!start.complete ? (
            <div className="ds-rise" style={rise(1)}>
              <StartHereCard start={start} />
            </div>
          ) : (
            <TiltCard
              label="Open Brain"
              onClick={() => emitAppEvent("open:brain")}
              style={rise(1)}
              className="relative min-h-[184px] overflow-hidden p-5 @xl:min-h-[220px] [background-image:radial-gradient(120%_90%_at_100%_100%,hsl(150_90%_55%/0.13),transparent_62%)]"
            >
              <h3 className="text-[18px] font-bold tracking-[-0.015em]">Mox knows your brand</h3>
              <p className="mt-1 text-[12px] text-muted-foreground">Everything is set up.</p>
              <Illustration
                kind="rocket"
                className="absolute -bottom-3 -right-3 h-[110px] w-[145px] @xl:h-[150px] @xl:w-[195px] transition-transform duration-500 group-hover:-translate-y-1.5 group-hover:rotate-[-2deg]"
              />
              <CardArrow className="absolute bottom-5 left-5" />
            </TiltCard>
          )}

          <TiltCard
            label="Swipe ideas"
            onClick={() => (onSwipe ? onSwipe() : create.open("social"))}
            style={rise(2)}
            className="relative min-h-[184px] overflow-hidden p-5 @xl:min-h-[220px] [background-image:radial-gradient(120%_90%_at_100%_100%,hsl(150_90%_55%/0.13),transparent_62%)]"
          >
            <span className="ds-grad-pill inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-bold">
              Popular
            </span>
            <h3 className="mt-2.5 text-[18px] font-bold tracking-[-0.015em]">Swipe ideas</h3>
            <p className="mt-1 max-w-[52%] text-[12.5px] leading-snug text-muted-foreground">
              Keep the ones you like. Mox writes them.
            </p>
            <Illustration
              kind="swipe"
              className="absolute -bottom-3 -right-3 h-[115px] w-[150px] @xl:h-[160px] @xl:w-[205px] transition-transform duration-500 group-hover:-translate-y-1.5 group-hover:rotate-[-2deg]"
            />
            {/* Holo's "Create swipes" link, a gradient underline under it. */}
            <span className="absolute bottom-5 left-5 inline-flex flex-col gap-1">
              <span className="inline-flex items-center gap-1 text-[12.5px] font-bold text-foreground/85 transition-colors group-hover:text-foreground">
                Create swipes
                <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </span>
              <span
                aria-hidden
                className="h-[2px] w-full origin-left rounded-full [background:var(--mox-gradient)] transition-transform duration-300 group-hover:scale-x-110"
              />
            </span>
          </TiltCard>
        </div>

        {/* Autopilot's own area (Holo): what it is doing, or the way to set it up. */}
        {autopilot ? (
          <div className="ds-rise mt-[14px]" style={rise(3)}>
            {autopilot}
          </div>
        ) : null}

        {/* Most popular */}
        <div className="ds-rise mb-3 mt-8 flex items-center justify-between" style={rise(4)}>
          <h3 className="text-[17px] font-bold tracking-[-0.015em]">Most popular</h3>
          <button
            type="button"
            onClick={() => emitAppEvent("open:create-launcher")}
            className="rounded-full px-2.5 py-1 text-[12px] font-semibold text-muted-foreground hover:bg-[var(--ds-well-bg)] hover:text-foreground"
          >
            See all
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2.5 @md:grid-cols-2 @3xl:grid-cols-3">
          {POPULAR.map((p, i) => (
            <TiltCard
              key={p.id}
              label={p.label}
              onClick={() =>
                p.choice === "animate"
                  ? emitAppEvent("open:animate")
                  : create.open(p.choice, p.controls ? { controls: p.controls } : undefined)
              }
              style={rise(5 + i)}
              className="h-16 min-w-0 !flex-row !items-center gap-2.5 px-2.5"
            >
              <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-[var(--ds-well-bg)] transition-transform duration-300 group-hover:scale-105">
                {p.photo ? (
                  <img
                    src={p.photo}
                    alt=""
                    width={44}
                    height={44}
                    decoding="async"
                    className="size-11 object-cover"
                  />
                ) : (
                  <Illustration kind={p.illo} className="size-11" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-semibold">{p.label}</span>
                  {p.choice !== "animate" && create.lockFor(p.choice) ? (
                    <PlanLock plan={create.lockFor(p.choice)!} />
                  ) : null}
                  {p.isNew && (
                    <span className="ds-grad-pill shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-bold">
                      New
                    </span>
                  )}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">{p.line}</span>
              </span>
            </TiltCard>
          ))}
          {/* Blog topics to write about: the idea deck, articles only. */}
          <TiltCard
            label="Blog ideas"
            onClick={() => (onSwipe ? onSwipe("article") : create.open("article"))}
            style={rise(5 + POPULAR.length)}
            className="h-16 min-w-0 !flex-row !items-center gap-2.5 px-2.5"
          >
            <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-[var(--ds-well-bg)] transition-transform duration-300 group-hover:scale-105">
              <Illustration kind="article" className="size-11" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">Blog ideas</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                Topics to write
              </span>
            </span>
          </TiltCard>
        </div>

        {/* Everything else Mellox does, each card with a preview (scroll on). */}
        <HomeExplore
          create={create}
          onSwipe={onSwipe}
          onAsk={onAsk}
          brain={brain}
          pulse={pulse}
          onCommunities={onCommunities}
        />
      </div>
    </div>
  );
}

/**
 * What is happening right now, from the free pulse: posts waiting, running
 * campaigns, the goal. Nothing shows when nothing is going on (or the read
 * failed), so a quiet brand never sees a row of zeros.
 */
function RightNow({
  pulse,
  onOpenWaiting,
}: {
  pulse?: WorkspacePulse | null;
  onOpenWaiting?: () => void;
}) {
  const items = rightNow(pulse);
  if (!items.length) return null;
  return (
    <div
      className="ds-rise -mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]"
      style={rise(0)}
      aria-label="Right now"
      role="list"
    >
      {items.map((item) => {
        const open =
          item.id === "waiting"
            ? onOpenWaiting
            : item.id === "goal"
              ? () => emitAppEvent("open:brain", { section: "brand" })
              : () =>
                  emitAppEvent("open:campaigns", {
                    campaignId: "campaignId" in item ? item.campaignId : undefined,
                  });
        return (
          <button
            key={item.id}
            role="listitem"
            type="button"
            onClick={open}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold shadow-[var(--ds-card-shadow)] transition-transform duration-200 hover:-translate-y-px active:scale-95",
              item.id === "waiting"
                ? "ds-grad-pill border-transparent"
                : "border-[var(--ds-card-border)] bg-[var(--ds-card-bg)]",
            )}
          >
            {item.id === "waiting" ? (
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-40 motion-reduce:hidden" />
                <span className="relative inline-flex size-2 rounded-full bg-current" />
              </span>
            ) : null}
            <span className="max-w-[220px] truncate">{item.label}</span>
            {"detail" in item && item.detail ? (
              <span className="text-muted-foreground">· {item.detail}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
