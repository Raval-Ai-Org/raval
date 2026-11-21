"use client";

import { Search, Share2, UserPlus, Sparkles, MoreHorizontal, Smile } from "@/components/icons";
import { MoxFace } from "@/components/brand/mox/MoxFace";
import { onboardingArt } from "@/lib/onboarding/art";
import type { CardArt as Art } from "@/lib/onboarding/questions";
import { cn } from "@/lib/utils";

const ICONS = {
  search: Search,
  share: Share2,
  friend: UserPlus,
  sparkle: Sparkles,
  more: MoreHorizontal,
} as const;

/**
 * What a card shows: a 3D Mox picture, or a small drawing made in code
 * (Mox figures for team size, a week of posts, caption lines, smiles).
 * Fills its box; the card decides the size.
 */
export function CardArt({ art, active }: { art: Art; active?: boolean }) {
  switch (art.kind) {
    case "image": {
      const src = onboardingArt(art.id);
      return src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          className="ob-art-img h-full w-full object-contain"
        />
      ) : (
        <span className="grid h-full w-full place-items-center">
          <MoxFace mood="happy" size={64} />
        </span>
      );
    }
    case "team":
      return <TeamArt count={art.count} />;
    case "calendar":
      return <WeekArt days={art.days} active={active} />;
    case "lines":
      return <LinesArt count={art.count} />;
    case "smiles":
      return <SmilesArt count={art.count} />;
    case "mox":
      return (
        <span className="grid h-full w-full place-items-center">
          <MoxFace mood="excited" size={72} track />
        </span>
      );
    case "icon": {
      const Icon = ICONS[art.name];
      return (
        <span className="grid h-full w-full place-items-center">
          <span className="grid size-16 place-items-center rounded-[22px] bg-[var(--ds-well-bg)] shadow-inner">
            <Icon className="size-7 text-foreground/80" aria-hidden />
          </span>
        </span>
      );
    }
  }
}

/** 1, 2, 4 or a crowd of little Mox, standing in a loose group. */
function TeamArt({ count }: { count: number }) {
  const src = onboardingArt("team-mini") ?? "/brand/mox/face.webp";
  const spots: { x: number; y: number; s: number }[] = {
    1: [{ x: 50, y: 52, s: 1 }],
    2: [
      { x: 38, y: 54, s: 0.9 },
      { x: 62, y: 50, s: 1 },
    ],
    4: [
      { x: 30, y: 44, s: 0.72 },
      { x: 70, y: 44, s: 0.72 },
      { x: 40, y: 58, s: 0.86 },
      { x: 62, y: 58, s: 0.86 },
    ],
    7: [
      { x: 20, y: 40, s: 0.55 },
      { x: 40, y: 36, s: 0.55 },
      { x: 60, y: 36, s: 0.55 },
      { x: 80, y: 40, s: 0.55 },
      { x: 30, y: 58, s: 0.7 },
      { x: 50, y: 60, s: 0.74 },
      { x: 70, y: 58, s: 0.7 },
    ],
  }[count] ?? [{ x: 50, y: 50, s: 1 }];
  return (
    <span className="relative block h-full w-full">
      {spots.map((p, i) => (
        <img
          key={i}
          src={src}
          alt=""
          draggable={false}
          className="ob-team absolute h-[70%] w-auto -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_8px_10px_rgb(0_0_0/0.12)]"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            height: `${70 * p.s}%`,
            zIndex: Math.round(p.y),
            animationDelay: `${i * 0.12}s`,
          }}
        />
      ))}
    </span>
  );
}

/** A week (M–S) with N days carrying a post. */
function WeekArt({ days, active }: { days: number; active?: boolean }) {
  const ON: Record<number, number[]> = {
    0: [],
    1: [3],
    3: [1, 3, 5],
    4: [0, 2, 4, 5],
    6: [0, 1, 2, 3, 4, 5],
    7: [0, 1, 2, 3, 4, 5, 6],
  };
  const on = new Set(ON[days] ?? []);
  return (
    <span className="grid h-full w-full place-items-center px-3">
      <span className="w-full max-w-[200px] rounded-2xl border border-[var(--ds-card-border)] bg-card p-2.5 shadow-[0_10px_24px_-18px_rgb(0_0_0/0.35)]">
        <span className="grid grid-cols-7 gap-1 text-center text-[9px] font-semibold text-muted-foreground">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </span>
        <span className="mt-1.5 grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }, (_, i) => (
            <span
              key={i}
              className={cn(
                "aspect-square rounded-[6px] transition-all duration-500",
                on.has(i) ? "ob-day-on" : "bg-[var(--ds-well-bg)]",
                on.has(i) && active && "scale-110",
              )}
              style={{ transitionDelay: `${i * 40}ms` }}
            />
          ))}
        </span>
      </span>
    </span>
  );
}

/** A caption: one, three or six lines. */
function LinesArt({ count }: { count: number }) {
  return (
    <span className="grid h-full w-full place-items-center px-4">
      <span className="flex w-full max-w-[180px] flex-col gap-1.5 rounded-2xl border border-[var(--ds-card-border)] bg-card p-3 shadow-[0_10px_24px_-18px_rgb(0_0_0/0.35)]">
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            className="ob-line h-1.5 rounded-full bg-foreground/15"
            style={{
              width: i === count - 1 && count > 1 ? "60%" : "100%",
              animationDelay: `${i * 0.08}s`,
            }}
          />
        ))}
      </span>
    </span>
  );
}

/** A caption bubble with no, one or three smiles. */
function SmilesArt({ count }: { count: number }) {
  return (
    <span className="grid h-full w-full place-items-center px-4">
      <span className="relative flex w-full max-w-[180px] flex-col gap-1.5 rounded-2xl rounded-bl-md border border-[var(--ds-card-border)] bg-card p-3 shadow-[0_10px_24px_-18px_rgb(0_0_0/0.35)]">
        <span className="h-1.5 w-full rounded-full bg-foreground/15" />
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 flex-1 rounded-full bg-foreground/15" />
          {Array.from({ length: count }, (_, i) => (
            <Smile
              key={i}
              className="ob-pop size-4 text-[var(--mox-green)]"
              strokeWidth={2.4}
              style={{ animationDelay: `${0.1 + i * 0.1}s` }}
              aria-hidden
            />
          ))}
        </span>
      </span>
    </span>
  );
}
