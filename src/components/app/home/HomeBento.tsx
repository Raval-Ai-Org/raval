"use client";

// Home (Mellox 2.0, ADR-0044), Holo style: a greeting, a bento of cards and
// the real message box docked under it (ChatPanel keeps the box). Every card
// opens an existing place; nothing here starts paid work by itself.

import { useRef, type CSSProperties, type ReactNode, type PointerEvent } from "react";
import { CardArrow } from "@/components/app/surface/MoxParts";
import { MoxFace } from "@/components/brand/mox/MoxFace";
import { PlanLock } from "@/components/app/billing/billing-ui";
import type { CreateChoice } from "@/components/studio/use-open-create";
import type { PlanId } from "@/lib/billing/catalog";
import { emitAppEvent } from "@/lib/app-events";
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
        "ds-card ds-card-hover ds-rise group text-left will-change-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
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

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 pb-6 pt-6 md:px-6 md:pt-10">
      {/* Greeting */}
      <div className="ds-rise mb-6 flex items-center gap-3" style={rise(0)}>
        <MoxFace mood="happy" size={44} track />
        <div className="min-w-0">
          <h2 className="text-[24px] font-bold leading-tight tracking-[-0.022em] md:text-[28px]">
            {first ? `Hi ${first}, ` : "Hi, "}
            <span className="ds-grad-text">what are we making?</span>
          </h2>
          <p className="text-[13px] text-muted-foreground">Pick a card or ask Mox below.</p>
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
            className="relative min-h-[210px] overflow-hidden p-[18px]"
          >
            <h3 className="text-[16px] font-bold">Mox knows your brand</h3>
            <p className="mt-1 text-[12px] text-muted-foreground">Everything is set up.</p>
            <Illustration
              kind="rocket"
              className="absolute -bottom-2 -right-2 h-[130px] w-[170px]"
            />
            <CardArrow className="absolute bottom-[18px] left-[18px]" />
          </TiltCard>
        )}

        <TiltCard
          label="Swipe ideas"
          onClick={() => create.open("social")}
          style={rise(2)}
          className="relative min-h-[210px] overflow-hidden p-[18px]"
        >
          <span className="ds-grad-pill inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-bold">
            Popular
          </span>
          <h3 className="mt-2 text-[16px] font-bold">Swipe ideas</h3>
          <p className="mt-1 max-w-[60%] text-[12px] text-muted-foreground">
            Keep the ones you like. Mox writes them.
          </p>
          <Illustration kind="swipe" className="absolute -bottom-3 -right-3 h-[140px] w-[180px]" />
          <CardArrow className="absolute bottom-[18px] left-[18px]" />
        </TiltCard>

        <TiltCard
          label={waiting ? "Open posts waiting" : "Open Autopilot"}
          onClick={() => (waiting ? onOpenWaiting() : emitAppEvent("open:autopilot"))}
          style={rise(3)}
          className="relative min-h-[210px] overflow-hidden p-[18px] sm:col-span-2 lg:col-span-1"
        >
          {waiting ? (
            <>
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-[var(--mox-yellow)] px-2.5 text-[11px] font-bold text-[var(--mox-ink)]">
                <span className="size-1.5 animate-pulse rounded-full bg-[var(--mox-ink)]" />
                {waiting} waiting
              </span>
              <h3 className="mt-2 text-[16px] font-bold">Posts need a yes</h3>
              <p className="mt-1 max-w-[60%] text-[12px] text-muted-foreground">
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
              <h3 className="mt-2 text-[16px] font-bold">Autopilot</h3>
              <p className="mt-1 max-w-[60%] text-[12px] text-muted-foreground">
                {autopilotOn ? "Posting every week for you." : "Posts every week by itself."}
              </p>
            </>
          )}
          <Illustration kind="rocket" className="absolute -bottom-3 -right-2 h-[140px] w-[170px]" />
          <CardArrow className="absolute bottom-[18px] left-[18px]" />
        </TiltCard>
      </div>

      {/* Most popular */}
      <div className="ds-rise mb-2 mt-7 flex items-center justify-between" style={rise(4)}>
        <h3 className="text-[15px] font-bold">Most popular</h3>
        <button
          type="button"
          onClick={() => emitAppEvent("open:create-launcher")}
          className="rounded-full px-2.5 py-1 text-[12px] font-semibold text-muted-foreground hover:bg-[var(--ds-well-bg)] hover:text-foreground"
        >
          See all
        </button>
      </div>
      <div className="-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {POPULAR.map((p, i) => (
          <TiltCard
            key={p.choice}
            label={p.label}
            onClick={() => create.open(p.choice)}
            style={rise(5 + i)}
            className="flex h-14 min-w-[200px] flex-1 snap-start items-center gap-2.5 px-2"
          >
            <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-[var(--ds-well-bg)]">
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
      <h3 className="ds-rise mb-2 mt-7 text-[15px] font-bold" style={rise(9)}>
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
              className="relative flex min-h-[128px] flex-col overflow-hidden p-[18px]"
            >
              <Illustration
                kind={b.illo}
                className="absolute -bottom-3 -right-4 h-[86px] w-[112px] transition-transform duration-500 group-hover:-translate-y-1 group-hover:rotate-[-3deg]"
              />
              <span className="relative flex items-center gap-2">
                <span className="text-[18px] font-bold tracking-tight">{b.label}</span>
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
