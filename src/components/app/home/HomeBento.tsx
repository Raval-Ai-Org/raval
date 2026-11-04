"use client";

// Home (Mellox 2.0, ADR-0044), Holo style: a greeting, a bento of cards and
// the real message box docked under it (ChatPanel keeps the box). Every card
// opens an existing place; nothing here starts paid work by itself.

import { useEffect, useRef, type CSSProperties, type ReactNode, type PointerEvent } from "react";
import { CardArrow } from "@/components/app/surface/MoxParts";
import { MoxFace } from "@/components/brand/mox/MoxFace";
import { PlanLock } from "@/components/app/billing/billing-ui";
import type { CreateChoice } from "@/components/studio/use-open-create";
import type { PlanId } from "@/lib/billing/catalog";
import { emitAppEvent } from "@/lib/app-events";
import { celebrate } from "@/lib/celebrate";
import type { WorkspacePulse } from "@/lib/pulse/pulse";
import { cn } from "@/lib/utils";
import { Illustration, type IlloKind } from "./illustrations";
import { StartHereCard, type StartHereView } from "./StartHere";

const POPULAR: { choice: CreateChoice; label: string; line: string; illo: IlloKind }[] = [
  { choice: "carousel", label: "Carousel", line: "Swipe-through story", illo: "carousel" },
  { choice: "story", label: "Story", line: "Full-screen frames", illo: "story" },
  { choice: "ad", label: "Ad", line: "Built to sell", illo: "ad" },
  { choice: "script", label: "Video script", line: "Words for a reel", illo: "animate" },
];

const BIG: { choice: CreateChoice; label: string; line: string; illo: IlloKind }[] = [
  { choice: "image", label: "Post", line: "A picture with captions", illo: "post" },
  { choice: "video", label: "Video", line: "A short clip for any app", illo: "video" },
  { choice: "article", label: "Article", line: "A blog post for your site", illo: "article" },
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
  name,
  pulse,
  onOpenWaiting,
  create,
  starters,
}: {
  start: StartHereView;
  name: string | null;
  pulse: WorkspacePulse | null | undefined;
  onOpenWaiting: () => void;
  /** `useOpenCreate()`: starts a format, or says which plan it needs. */
  create: {
    open: (choice: CreateChoice) => boolean;
    lockFor: (choice: CreateChoice) => PlanId | null;
  };
  /** The "Try" ideas (ChatStarters), shown under the cards. */
  starters?: ReactNode;
}) {
  const first = name?.trim().split(/\s+/)[0];
  const waiting = pulse?.waiting ?? 0;
  const autopilotOn = pulse?.autopilot.status === "running";
  // Confetti only when Start here finishes while you watch, never on load.
  const wasComplete = useRef(start.complete);
  useEffect(() => {
    if (start.complete && !wasComplete.current) celebrate();
    wasComplete.current = start.complete;
  }, [start.complete]);

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 pb-6 pt-6 md:px-6 md:pt-10">
      {/* Greeting */}
      <div className="ds-rise mb-7 flex items-center gap-4" style={rise(0)}>
        <span className="mox-float shrink-0">
          <MoxFace mood="happy" size={60} track />
        </span>
        <div className="min-w-0">
          <h2 className="text-[26px] font-bold leading-[1.1] tracking-[-0.03em] md:text-[32px]">
            {first ? `Hi ${first}, ` : "Hi, "}
            <span className="ds-grad-text">what are we making?</span>
          </h2>
          <p className="mt-1 text-[13.5px] text-muted-foreground">Pick a card or ask Mox below.</p>
        </div>
      </div>

      {/* Bento */}
      <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-3">
        {!start.complete ? (
          <div className="ds-rise sm:row-span-2 lg:row-span-1" style={rise(1)}>
            <StartHereCard start={start} />
          </div>
        ) : (
          <TiltCard
            label="Open Brain"
            onClick={() => emitAppEvent("open:brain")}
            style={rise(1)}
            className="relative min-h-[220px] overflow-hidden p-5 [background-image:radial-gradient(120%_90%_at_100%_100%,hsl(150_90%_55%/0.13),transparent_62%)]"
          >
            <h3 className="text-[18px] font-bold tracking-[-0.015em]">Mox knows your brand</h3>
            <p className="mt-1 text-[12px] text-muted-foreground">Everything is set up.</p>
            <Illustration
              kind="rocket"
              className="absolute -bottom-3 -right-3 h-[150px] w-[195px] transition-transform duration-500 group-hover:-translate-y-1.5 group-hover:rotate-[-2deg]"
            />
            <CardArrow className="absolute bottom-5 left-5" />
          </TiltCard>
        )}

        <TiltCard
          label="Swipe ideas"
          onClick={() => create.open("social")}
          style={rise(2)}
          className="relative min-h-[220px] overflow-hidden p-5 [background-image:radial-gradient(120%_90%_at_100%_100%,hsl(150_90%_55%/0.13),transparent_62%)]"
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
            className="absolute -bottom-3 -right-3 h-[160px] w-[205px] transition-transform duration-500 group-hover:-translate-y-1.5 group-hover:rotate-[-2deg]"
          />
          <CardArrow className="absolute bottom-5 left-5" />
        </TiltCard>

        <TiltCard
          label={waiting ? "Open posts waiting" : "Open Autopilot"}
          onClick={() => (waiting ? onOpenWaiting() : emitAppEvent("open:autopilot"))}
          style={rise(3)}
          className="relative min-h-[220px] overflow-hidden p-5 [background-image:radial-gradient(120%_90%_at_100%_100%,hsl(195_95%_55%/0.13),transparent_62%)] sm:col-span-2 lg:col-span-1"
        >
          {waiting ? (
            <>
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-[var(--mox-yellow)] px-2.5 text-[11px] font-bold text-[var(--mox-ink)]">
                <span className="size-1.5 animate-pulse rounded-full bg-[var(--mox-ink)]" />
                {waiting} waiting
              </span>
              <h3 className="mt-2.5 text-[18px] font-bold tracking-[-0.015em]">Posts need a yes</h3>
              <p className="mt-1 max-w-[52%] text-[12.5px] leading-snug text-muted-foreground">
                Check them before they go out.
              </p>
            </>
          ) : (
            <>
              <span
                className={cn(
                  "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-bold",
                  autopilotOn
                    ? "bg-[var(--mox-green)] text-white"
                    : "bg-[var(--ds-well-bg)] text-foreground/70",
                )}
              >
                {autopilotOn ? "On" : "Off"}
              </span>
              <h3 className="mt-2.5 text-[18px] font-bold tracking-[-0.015em]">Autopilot</h3>
              <p className="mt-1 max-w-[52%] text-[12.5px] leading-snug text-muted-foreground">
                {autopilotOn ? "Posting every week for you." : "Posts every week by itself."}
              </p>
            </>
          )}
          <Illustration
            kind="rocket"
            className="absolute -bottom-3 -right-2 h-[160px] w-[195px] transition-transform duration-500 group-hover:-translate-y-2"
          />
          <CardArrow className="absolute bottom-5 left-5" />
        </TiltCard>
      </div>

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
      <div className="-mx-2 -my-2 flex snap-x gap-2.5 overflow-x-auto overflow-y-hidden px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {POPULAR.map((p, i) => (
          <TiltCard
            key={p.choice}
            label={p.label}
            onClick={() => create.open(p.choice)}
            style={rise(5 + i)}
            className="h-16 min-w-[200px] flex-1 snap-start !flex-row !items-center gap-3 px-2.5"
          >
            <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-[var(--ds-well-bg)] transition-transform duration-300 group-hover:scale-105">
              <Illustration kind={p.illo} className="size-11" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{p.label}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{p.line}</span>
            </span>
          </TiltCard>
        ))}
      </div>

      {/* Create */}
      <h3 className="ds-rise mb-3 mt-8 text-[17px] font-bold tracking-[-0.015em]" style={rise(9)}>
        Create
      </h3>
      <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-3">
        {BIG.map((b, i) => {
          const lock = create.lockFor(b.choice);
          return (
            <TiltCard
              key={b.choice}
              label={`Create ${b.label}`}
              onClick={() => create.open(b.choice)}
              style={rise(10 + i)}
              className="relative min-h-[140px] overflow-hidden p-5"
            >
              <Illustration
                kind={b.illo}
                className="absolute -bottom-3 -right-4 h-[100px] w-[130px] transition-transform duration-500 group-hover:-translate-y-1 group-hover:rotate-[-3deg]"
              />
              <span className="relative flex items-center gap-2">
                <span className="text-[20px] font-bold tracking-[-0.02em]">{b.label}</span>
                {lock && <PlanLock plan={lock} />}
              </span>
              <span className="relative mt-0.5 block max-w-[56%] text-[12px] leading-snug text-muted-foreground">
                {b.line}
              </span>
              <span className="relative mt-auto pt-3">
                <CardArrow />
              </span>
            </TiltCard>
          );
        })}
      </div>

      {starters ? (
        <div className="ds-rise mt-7" style={rise(13)}>
          {starters}
        </div>
      ) : null}
    </div>
  );
}
