"use client";

// Home's lower sections (Mellox 2.0, ADR-0044), Holo style: a person scrolls
// and sees everything Mellox can do, with a preview on every card so nothing
// has to be opened to understand it. Each card opens an existing place; the
// quick picks inside a card open that place on the exact format. Nothing here
// starts paid work: the Ask Mox chips only fill the message box.
//
// Presentational: HomeBento places it, ChatPanel wires it, `/home-lab`
// renders it with sample data.

import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";
import { PlanLock } from "@/components/app/billing/billing-ui";
import { CardArrow, GradProgress } from "@/components/app/surface/MoxParts";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Brain,
  CalendarDays,
  Eye,
  Image as ImageIcon,
  Megaphone,
  MessageSquare,
  Palette,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Compass,
} from "@/components/icons";
import type { PlanId } from "@/lib/billing/catalog";
import { emitAppEvent } from "@/lib/app-events";
import type { BrainOverview } from "@/lib/brain/brain";
import {
  askPrompts,
  brainTiles,
  homeNeeds,
  latestUpdates,
  type BrainTileId,
} from "@/lib/home/explore";
import type { WorkspacePulse } from "@/lib/pulse/pulse";
import type { StudioType } from "@/lib/studio/formats";
import type { StudioControls } from "@/lib/studio/jobs";
import { CREATOR_PHOTO_IDS } from "@/lib/ugc/creator-photos";
import { stockCreator } from "@/lib/ugc/creators";
import { UGC_FORMAT_GROUPS, UGC_FORMATS } from "@/lib/ugc/formats";
import { cn } from "@/lib/utils";
import { Illustration, type IlloKind } from "./illustrations";
import { BrainFlow, CreatorPhone, MakeFlow, NeedsAndNews } from "./HomeMotion";

export type HomeCreateChoice = StudioType | "ugc";
export type HomeCreateControls = Partial<
  Pick<StudioControls, "videoKind" | "videoMode" | "recapMotion">
>;

export type HomeCreate = {
  open: (choice: HomeCreateChoice, opts?: { controls?: HomeCreateControls }) => boolean;
  lockFor: (choice: HomeCreateChoice) => PlanId | null;
};

const rise = (i: number) => ({ ["--i" as string]: i }) as CSSProperties;

type Icon = ComponentType<{ className?: string }>;

/* ── Section heading ─────────────────────────────────────────────────── */

function SectionHead({
  title,
  line,
  action,
  index,
}: {
  title: string;
  line?: string;
  action?: { label: string; onClick: () => void };
  index: number;
}) {
  return (
    <div className="ds-rise mb-3 mt-10 flex items-end justify-between gap-3" style={rise(index)}>
      <div className="min-w-0">
        <h3 className="text-[17px] font-bold tracking-[-0.015em]">{title}</h3>
        {line ? <p className="mt-0.5 text-[12.5px] text-muted-foreground">{line}</p> : null}
      </div>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-[var(--ds-well-bg)] hover:text-foreground"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

/** A small pill inside a card that opens one exact format. */
function QuickPick({
  label,
  onClick,
  lock,
}: {
  label: string;
  onClick: () => void;
  lock?: PlanId | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative z-[1] inline-flex h-7 items-center gap-1 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] px-2.5 text-[11.5px] font-semibold text-foreground/80 shadow-[var(--ds-card-shadow)] transition-[transform,background-color,color] duration-200 hover:-translate-y-px hover:bg-foreground hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-95"
    >
      {label}
      {lock ? <PlanLock plan={lock} /> : null}
    </button>
  );
}

/**
 * A card with a whole-card button behind it and its own buttons on top
 * (never a button inside a button).
 */
function LayeredCard({
  label,
  onClick,
  index,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  index: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("ds-card ds-card-hover ds-rise group relative overflow-hidden", className)}
      style={rise(index)}
    >
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="absolute inset-0 z-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      />
      {children}
    </div>
  );
}

/* ── Make anything: the big three, each with its quick picks ─────────── */

type QuickPickItem = {
  label: string;
  choice: HomeCreateChoice | "animate" | "blog-ideas";
  controls?: HomeCreateControls;
};

const MAKE: {
  id: string;
  label: string;
  line: string;
  illo: IlloKind;
  choice: HomeCreateChoice;
  picks: QuickPickItem[];
}[] = [
  {
    id: "posts",
    label: "Posts",
    line: "Pictures, slides and Stories with captions for every app",
    illo: "post",
    choice: "image",
    picks: [
      { label: "Image post", choice: "image" },
      { label: "Carousel", choice: "carousel" },
      { label: "Story", choice: "story" },
      { label: "Text post", choice: "social" },
      { label: "Image ad", choice: "ad" },
    ],
  },
  {
    id: "videos",
    label: "Videos",
    line: "Creator ads, product clips, your own footage and motion",
    illo: "video",
    choice: "video",
    picks: [
      { label: "Creator video", choice: "ugc" },
      { label: "Product video", choice: "video", controls: { videoKind: "product-motion" } },
      { label: "Animate a post", choice: "animate" },
      { label: "Edit my clips", choice: "video", controls: { videoMode: "brand" } },
      {
        label: "Motion graphics",
        choice: "video",
        controls: { videoKind: "motion-graphics", videoMode: "motion" },
      },
      { label: "Website tour", choice: "video", controls: { videoMode: "site" } },
      {
        label: "Photo slideshow",
        choice: "video",
        controls: { videoMode: "recap", recapMotion: "camera" },
      },
    ],
  },
  {
    id: "writing",
    label: "Blog & writing",
    line: "Articles for your site and scripts to film yourself",
    illo: "article",
    choice: "article",
    picks: [
      { label: "Blog article", choice: "article" },
      { label: "Blog ideas", choice: "blog-ideas" },
      { label: "Video script", choice: "script" },
    ],
  },
];

function MakeAnything({
  create,
  onSwipe,
  index,
}: {
  create: HomeCreate;
  onSwipe?: (type?: StudioType) => void;
  index: number;
}) {
  const run = (p: QuickPickItem) => {
    if (p.choice === "animate") return emitAppEvent("open:animate");
    if (p.choice === "blog-ideas") return onSwipe ? onSwipe("article") : create.open("article");
    create.open(p.choice, p.controls ? { controls: p.controls } : undefined);
  };
  return (
    <>
      <SectionHead
        index={index}
        title="Make anything"
        line="Tap a card to start, or jump straight to a format"
        action={{ label: "See all", onClick: () => emitAppEvent("open:create-launcher") }}
      />
      <MakeFlow className="ds-rise mb-[14px]" />
      <div className="grid grid-cols-1 gap-[14px] @xl:grid-cols-3">
        {MAKE.map((m, i) => {
          const lock = create.lockFor(m.choice);
          return (
            <LayeredCard
              key={m.id}
              label={`Create ${m.label}`}
              onClick={() => create.open(m.choice)}
              index={index + 1 + i}
              className="flex min-h-[210px] flex-col p-5"
            >
              <Illustration
                kind={m.illo}
                className="pointer-events-none absolute -right-4 -top-2 h-[96px] w-[126px] transition-transform duration-500 group-hover:-translate-y-1 group-hover:rotate-[-3deg]"
              />
              <span className="pointer-events-none relative flex items-center gap-2">
                <span className="text-[20px] font-bold tracking-[-0.02em]">{m.label}</span>
                {lock && <PlanLock plan={lock} />}
              </span>
              <span className="pointer-events-none relative mt-1 block max-w-[62%] text-[12px] leading-snug text-muted-foreground">
                {m.line}
              </span>
              <span className="relative mt-auto flex flex-wrap gap-1.5 pt-4">
                {m.picks.map((p) => (
                  <QuickPick key={p.label} label={p.label} onClick={() => run(p)} />
                ))}
              </span>
            </LayeredCard>
          );
        })}
      </div>
    </>
  );
}

/* ── Creator videos: faces and formats, previewed on the card ─────────── */

const SHOWN_CREATORS = CREATOR_PHOTO_IDS.slice(0, 6)
  .map((id) => stockCreator(id))
  .filter((c): c is NonNullable<typeof c> => !!c);

const FORMAT_COUNTS = UGC_FORMAT_GROUPS.map((g) => ({
  ...g,
  count: UGC_FORMATS.filter((f) => f.group === g.id).length,
})).filter((g) => g.count > 0);

function CreatorVideos({ create, index }: { create: HomeCreate; index: number }) {
  const lock = create.lockFor("ugc");
  return (
    <>
      <SectionHead
        index={index}
        title="Creator videos"
        line="A creator talks up your product, like a real Reel"
      />
      <LayeredCard
        label="Make a creator video"
        onClick={() => create.open("ugc")}
        index={index + 1}
        className="p-5 [background-image:radial-gradient(90%_120%_at_100%_0%,hsl(150_90%_55%/0.14),transparent_60%)] @xl:p-6"
      >
        <div className="pointer-events-none relative flex flex-col gap-5 @2xl:flex-row @2xl:items-center">
          <div className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="ds-grad-pill inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-bold">
                Most used
              </span>
              {lock && <PlanLock plan={lock} />}
            </span>
            <h4 className="mt-2.5 text-[20px] font-bold tracking-[-0.02em]">
              Pick a creator. Add your product.
            </h4>
            <p className="mt-1 max-w-[46ch] text-[12.5px] leading-snug text-muted-foreground">
              Mox writes the script in your voice; you edit any line before anything is made.
            </p>
            <div className="mt-3.5 flex flex-wrap gap-1.5">
              {FORMAT_COUNTS.map((g) => (
                <span
                  key={g.id}
                  className="inline-flex h-6 items-center gap-1 rounded-full bg-[var(--ds-well-bg)] px-2.5 text-[11px] font-semibold text-foreground/75"
                >
                  {g.label}
                  <span className="tabular-nums text-muted-foreground">{g.count}</span>
                </span>
              ))}
            </div>
          </div>
          {/* A Reel playing, then the creators to pick from. */}
          <div className="flex shrink-0 items-center gap-4">
            <CreatorPhone
              photo={`/creators/${SHOWN_CREATORS[0]?.id ?? "amara"}.jpg`}
              hook="Wait till you see this"
            />
            <div className="flex -space-x-3 transition-[gap] duration-500 group-hover:-space-x-1">
              {SHOWN_CREATORS.map((c, i) => (
                <figure
                  key={c.id}
                  className="relative transition-transform duration-500 group-hover:-translate-y-1"
                  style={{ transitionDelay: `${i * 40}ms` }}
                >
                  <img
                    src={`/creators/${c.id}.jpg`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width={56}
                    height={72}
                    className="h-[72px] w-14 rounded-[16px] border-2 border-[var(--ds-card-bg)] object-cover shadow-[var(--ds-card-shadow)]"
                  />
                  <figcaption className="sr-only">{c.name}</figcaption>
                </figure>
              ))}
            </div>
            <CardArrow className="ml-3" />
          </div>
        </div>
      </LayeredCard>
    </>
  );
}

/* ── Your brand's brain ──────────────────────────────────────────────── */

const BRAIN_ICON: Record<BrainTileId, Icon> = {
  brand: Sparkles,
  audience: Users,
  competitors: Target,
  market: TrendingUp,
  strategy: Compass,
};

function BrainTiles({ overview, index }: { overview?: BrainOverview | null; index: number }) {
  const tiles = brainTiles(overview);
  const enabled = overview ? new Set(tiles.map((t) => t.id)) : undefined;
  const openBrain = (section: BrainTileId) => emitAppEvent("open:brain", { section });
  return (
    <>
      <SectionHead
        index={index}
        title="Your brand's brain"
        line="What Mox knows and uses in every piece"
        action={{ label: "Open Brain", onClick: () => emitAppEvent("open:brain") }}
      />
      <BrainFlow enabled={enabled} className="ds-rise mb-2.5" />
      <div className="mb-2.5">
        <NeedsAndNews
          needs={homeNeeds(overview)}
          updates={latestUpdates(overview)}
          onOpen={openBrain}
        />
      </div>
      <div className="grid grid-cols-1 gap-2.5 @md:grid-cols-2 @3xl:grid-cols-3">
        {tiles.map((t, i) => {
          const Icon = BRAIN_ICON[t.id];
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => emitAppEvent("open:brain", { section: t.id })}
              style={rise(index + 1 + i)}
              className="ds-card ds-card-hover ds-rise group flex min-h-[118px] flex-col p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-[0.99]"
            >
              <span className="flex w-full items-center gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-[var(--ds-well-bg)] transition-transform duration-300 group-hover:scale-110">
                  <Icon className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{t.label}</span>
                <ArrowUpRight className="size-4 text-muted-foreground opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100" />
              </span>
              <span className="mt-2 line-clamp-2 text-[12px] leading-snug text-muted-foreground">
                {t.line}
              </span>
              <span className="mt-auto flex w-full flex-wrap items-center gap-1 pt-2.5">
                {t.facts.map((f) => (
                  <span
                    key={f}
                    className="max-w-full truncate rounded-full bg-[var(--ds-well-bg)] px-2 py-0.5 text-[10.5px] font-semibold text-foreground/75"
                  >
                    {f}
                  </span>
                ))}
                {t.health !== null ? (
                  <GradProgress
                    value={t.health}
                    label={`${t.label} filled in`}
                    className="mt-1.5 w-full"
                  />
                ) : null}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => emitAppEvent("open:inspo")}
          style={rise(index + 1 + tiles.length)}
          className="ds-card ds-card-hover ds-rise group flex min-h-[118px] flex-col p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-[0.99]"
        >
          <span className="flex w-full items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-[var(--ds-well-bg)] transition-transform duration-300 group-hover:scale-110">
              <Palette className="size-[18px]" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] font-bold">Inspo</span>
            <ArrowUpRight className="size-4 text-muted-foreground opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100" />
          </span>
          <span className="mt-2 line-clamp-2 text-[12px] leading-snug text-muted-foreground">
            Pictures you love, your post and video look, your voice
          </span>
          {/* A tiny mood board. */}
          <span aria-hidden className="mt-auto flex gap-1 pt-2.5">
            {["#E9FB7A", "#7FEA5A", "#21C77A", "#3AB6F4", "#2B6FF0"].map((c, i) => (
              <span
                key={c}
                className="h-5 flex-1 rounded-[6px] transition-transform duration-300 group-hover:-translate-y-0.5"
                style={{ background: c, transitionDelay: `${i * 35}ms`, opacity: 0.85 }}
              />
            ))}
          </span>
        </button>
      </div>
    </>
  );
}

/* ── Plan and grow ───────────────────────────────────────────────────── */

/** Small drawn previews: shapes only, never a number that isn't real. */
function Preview({ kind }: { kind: "calendar" | "bars" | "eye" | "phases" | "chat" | "stack" }) {
  if (kind === "calendar")
    return (
      <span aria-hidden className="grid grid-cols-7 gap-[3px]">
        {Array.from({ length: 21 }, (_, i) => (
          <span
            key={i}
            className={cn(
              "size-[7px] rounded-[2px] transition-colors duration-500",
              [2, 5, 9, 11, 16, 19].includes(i)
                ? "home-blink [background:var(--mox-gradient)]"
                : "bg-[var(--ds-well-bg)] group-hover:bg-foreground/10",
            )}
            style={{ ["--d" as string]: `${(i % 7) * 0.3}s` }}
          />
        ))}
      </span>
    );
  if (kind === "bars")
    return (
      <span aria-hidden className="flex h-[30px] items-end gap-[3px]">
        {[40, 62, 48, 75, 58, 90].map((h, i) => (
          <span
            key={i}
            className="home-breathe w-[7px] rounded-t-[2px] [background:var(--mox-gradient)]"
            style={{
              height: `${h}%`,
              opacity: 0.55 + i * 0.07,
              ["--d" as string]: `${i * 0.18}s`,
            }}
          />
        ))}
      </span>
    );
  if (kind === "phases")
    return (
      <span aria-hidden className="flex flex-col items-start gap-[3px]">
        {["Tease", "Launch", "After"].map((p, i) => (
          <span
            key={p}
            className={cn(
              "whitespace-nowrap rounded-full px-1.5 text-[8.5px] font-bold leading-[13px] transition-transform duration-300 group-hover:translate-x-0.5",
              i === 1 ? "ds-grad-pill ml-2" : "bg-[var(--ds-card-bg)] text-foreground/70",
            )}
            style={{ transitionDelay: `${i * 50}ms` }}
          >
            {p}
          </span>
        ))}
      </span>
    );
  if (kind === "chat")
    return (
      <span aria-hidden className="flex flex-col gap-1">
        <span className="h-2.5 w-12 rounded-full bg-[var(--ds-card-bg)]" />
        <span className="home-blink ml-4 h-2.5 w-10 rounded-full [background:var(--mox-gradient)] transition-transform duration-300 group-hover:translate-x-1" />
      </span>
    );
  if (kind === "stack")
    return (
      <span aria-hidden className="relative block h-[30px] w-[54px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="absolute top-0 h-[30px] w-[24px] rounded-[6px] border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] shadow-[var(--ds-card-shadow)] transition-transform duration-500"
            style={{ left: i * 14, transform: `rotate(${(i - 1) * 7}deg)` }}
          >
            <span className="absolute inset-1 rounded-[4px] [background:var(--mox-gradient)] opacity-40" />
          </span>
        ))}
      </span>
    );
  return (
    <span aria-hidden className="relative grid size-[30px] place-items-center">
      <span className="absolute inset-0 rounded-full border-[3px] border-[var(--ds-well-bg)]" />
      <span className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-[#3fe46e] border-r-[#1fd6c4] animate-[spin_5s_linear_infinite] motion-reduce:animate-none" />
      <Eye className="size-3.5" />
    </span>
  );
}

type GrowTile = {
  id: string;
  label: string;
  line: string;
  icon: Icon;
  preview: Parameters<typeof Preview>[0]["kind"];
  onClick: () => void;
};

function PlanAndGrow({ index, onCommunities }: { index: number; onCommunities?: () => void }) {
  const tiles: GrowTile[] = [
    {
      id: "campaigns",
      label: "Campaigns",
      line: "A launch, sale or event, planned around its date",
      icon: Megaphone,
      preview: "phases",
      onClick: () => emitAppEvent("open:campaigns"),
    },
    {
      id: "calendar",
      label: "Calendar",
      line: "Every post on its day, moved with a drag",
      icon: CalendarDays,
      preview: "calendar",
      onClick: () => emitAppEvent("open:content-calendar"),
    },
    {
      id: "analytics",
      label: "Analytics",
      line: "Your posts, site and search in one place",
      icon: BarChart3,
      preview: "bars",
      onClick: () => emitAppEvent("open:analytics"),
    },
    {
      id: "visibility",
      label: "AI visibility",
      line: "How ChatGPT and Google see your website",
      icon: Eye,
      preview: "eye",
      onClick: () => emitAppEvent("open:ai-visibility"),
    },
    ...(onCommunities
      ? [
          {
            id: "communities",
            label: "Communities",
            line: "Reddit threads where people ask for what you sell",
            icon: MessageSquare,
            preview: "chat" as const,
            onClick: onCommunities,
          },
        ]
      : []),
    {
      id: "library",
      label: "Library",
      line: "Everything you've made, ready to reuse",
      icon: ImageIcon,
      preview: "stack",
      onClick: () => emitAppEvent("open:library"),
    },
  ];
  return (
    <>
      <SectionHead index={index} title="Plan and grow" line="Get posts out and see what works" />
      <div className="grid grid-cols-1 gap-2.5 @md:grid-cols-2 @3xl:grid-cols-3">
        {tiles.map((t, i) => (
          <button
            key={t.id}
            type="button"
            onClick={t.onClick}
            style={rise(index + 1 + i)}
            className="ds-card ds-card-hover ds-rise group flex items-center gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-[0.99]"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <t.icon className="size-4 shrink-0" />
                <span className="truncate text-[14px] font-bold">{t.label}</span>
              </span>
              <span className="mt-1 line-clamp-2 block text-[12px] leading-snug text-muted-foreground">
                {t.line}
              </span>
            </span>
            <span className="grid h-[56px] w-[80px] shrink-0 place-items-center overflow-hidden rounded-[14px] bg-[var(--ds-well-bg)]">
              <Preview kind={t.preview} />
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

/* ── Ask Mox ─────────────────────────────────────────────────────────── */

function AskMox({
  pulse,
  onAsk,
  index,
}: {
  pulse?: WorkspacePulse | null;
  onAsk: (text: string) => void;
  index: number;
}) {
  const asks = askPrompts(pulse);
  return (
    <>
      <SectionHead index={index} title="Ask Mox" line="Tap one to put it in the message box" />
      <div className="ds-rise grid grid-cols-1 gap-2 @xl:grid-cols-2" style={rise(index + 1)}>
        {asks.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onAsk(q)}
            className="group flex items-center gap-2.5 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] py-2 pl-2 pr-3 text-left text-[13px] font-medium shadow-[var(--ds-card-shadow)] transition-[transform,border-color] duration-200 hover:-translate-y-px hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-[0.99]"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--ds-well-bg)]">
              <Brain className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate">{q}</span>
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </button>
        ))}
      </div>
    </>
  );
}

/* ── All of it ───────────────────────────────────────────────────────── */

export function HomeExplore({
  create,
  onSwipe,
  onAsk,
  brain,
  pulse,
  onCommunities,
}: {
  create: HomeCreate;
  onSwipe?: (type?: StudioType) => void;
  /** Puts a question in the message box; never sends it. */
  onAsk?: (text: string) => void;
  /** The free Brain overview, for real lines and numbers on the tiles. */
  brain?: BrainOverview | null;
  pulse?: WorkspacePulse | null;
  /** Opens the Reddit agent (a route); the tile is hidden without it. */
  onCommunities?: () => void;
}) {
  return (
    <>
      <Reveal>
        <MakeAnything create={create} onSwipe={onSwipe} index={0} />
      </Reveal>
      <Reveal>
        <CreatorVideos create={create} index={0} />
      </Reveal>
      <Reveal>
        <BrainTiles overview={brain} index={0} />
      </Reveal>
      <Reveal>
        <PlanAndGrow index={0} onCommunities={onCommunities} />
      </Reveal>
      {onAsk ? (
        <Reveal>
          <AskMox pulse={pulse} onAsk={onAsk} index={0} />
        </Reveal>
      ) : null}
    </>
  );
}

/**
 * A section's cards rise when it scrolls into view, not on load, so the
 * stagger is short and seen. Without IntersectionObserver it shows at once;
 * reduced motion skips the animation (the `ds-rise` rule) and just shows it.
 */
function Reveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      data-shown={shown || undefined}
      className={cn(!shown && "[&_.ds-rise]:![animation:none] [&_.ds-rise]:opacity-0")}
    >
      {children}
    </div>
  );
}
