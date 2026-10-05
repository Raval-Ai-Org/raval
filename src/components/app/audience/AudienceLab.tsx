"use client";

// Development-only: the Audience screens with sample data, so layout, copy and
// motion can be checked without a workspace or a sign-in. Mounted at
// /audience-lab.
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Tile } from "@/components/app/surface/SurfaceLayout";
import type {
  AudienceView,
  Dimensions,
  PredictionView,
  RunView,
  TournamentOutput,
  TwinView,
} from "@/lib/audience/contracts";
import { makeTrait } from "@/lib/audience/twins";
import { PredictionDetail, Ranking, RunProgress, ScoreChip } from "./audience-ui";
import { AudienceScreen, type AudienceHandlers } from "./AudienceScreen";

const MIN = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN).toISOString();
const dims = (
  fit: number,
  hook: number,
  clarity: number,
  trust: number,
  cta: number,
): Dimensions => ({
  fit,
  hook,
  clarity,
  trust,
  cta,
});

const owners: TwinView = {
  id: "t1",
  slug: "cafe-owners",
  kind: "group",
  name: "Independent café owners",
  segment: "Owner-operator, one or two sites",
  summary:
    "Runs the floor most days and does the ordering at night. Wants better coffee without another thing to manage.",
  weight: 60,
  origin: "brand_dna",
  known: 68,
  updatedAt: ago(90),
  traits: [
    makeTrait("goal", "Regulars who come back every morning", "brand_dna"),
    makeTrait("goal", "Less waste from stale beans", "user"),
    makeTrait("pain", "No time to compare suppliers", "brand_dna"),
    makeTrait("objection", "Worried a subscription locks them in", "market"),
    makeTrait("trigger", "A bad review that mentions the coffee", "assumed"),
    makeTrait("channel", "Instagram in the evening", "assumed"),
  ],
};

const managers: TwinView = {
  id: "t2",
  slug: "cafe-managers",
  kind: "group",
  name: "Café managers",
  segment: "Runs a site for someone else",
  summary:
    "Judged on margin and staff turnover. Needs something the team can make well every time.",
  weight: 40,
  origin: "generated",
  known: 52,
  updatedAt: ago(90),
  traits: [
    makeTrait("goal", "Consistent drinks across shifts", "competitor"),
    makeTrait("pain", "New baristas take weeks to train", "assumed"),
    makeTrait("objection", "Has to justify any price rise to the owner", "assumed"),
  ],
};

const pulse: PredictionView = {
  id: "p1",
  contentItemId: "c1",
  depth: "pulse",
  title: "Stale beans cost you more than fresh ones",
  platform: "instagram",
  overall: 74,
  dimensions: dims(82, 78, 80, 66, 58),
  why: "Owners liked that it starts with waste, which they feel every week. Managers wanted to know what it costs before they would look further.",
  fixes: [
    "Say what a month costs for a small café",
    "End with one clear step, like asking for a sample bag",
  ],
  notes: [{ id: "no_next_step", level: "warn", text: "It doesn't say what to do next." }],
  confidence: "medium",
  measuredPosts: 0,
  calibrated: false,
  createdAt: ago(12),
  pulse: {
    sentiment: { positive: 56, neutral: 25, negative: 19 },
    people: 16,
    strengths: ["Opens with a cost they recognise", "Short enough to read between customers"],
    objections: ["No price anywhere", "Sounds like a contract"],
    segments: [
      { twinId: "t1", name: "Independent café owners", score: 81, note: "No price anywhere" },
      { twinId: "t2", name: "Café managers", score: 63, note: "Sounds like a contract" },
    ],
    reactions: [
      {
        twinId: "t1",
        twinName: "Independent café owners",
        who: "Owner, closes up herself",
        stance: "love",
        quote: "That's exactly the bin I empty every Sunday.",
        wouldAct: true,
      },
      {
        twinId: "t1",
        twinName: "Independent café owners",
        who: "Opened eight months ago",
        stance: "like",
        quote: "Makes sense, but what does it cost me?",
        wouldAct: false,
      },
      {
        twinId: "t2",
        twinName: "Café managers",
        who: "Manages a busy station site",
        stance: "neutral",
        quote: "I'd need a number before I show my boss.",
        wouldAct: false,
      },
      {
        twinId: "t2",
        twinName: "Café managers",
        who: "Ten years behind the bar",
        stance: "skip",
        quote: "Another subscription. I've seen these.",
        wouldAct: false,
      },
      {
        twinId: "t1",
        twinName: "Independent café owners",
        who: "Two sites, short on staff",
        stance: "like",
        quote: "If it saves me ordering on a Sunday night, I'm listening.",
        wouldAct: true,
      },
      {
        twinId: "t2",
        twinName: "Café managers",
        who: "New in the job",
        stance: "dislike",
        quote: "Feels like it's blaming me for the waste.",
        wouldAct: false,
      },
      {
        twinId: "t1",
        twinName: "Independent café owners",
        who: "Skims on the bus",
        stance: "neutral",
        quote: "I'd read it properly later. Probably.",
        wouldAct: false,
      },
    ],
  },
};

const quick: PredictionView = {
  ...pulse,
  id: "p2",
  contentItemId: "c2",
  depth: "score",
  title: "Three ways to dial in your grinder",
  platform: "linkedin",
  overall: 58,
  dimensions: dims(64, 48, 72, 60, 44),
  why: "Useful, but the first line could be about any grinder from any brand.",
  fixes: ["Open with the mistake most cafés make", "Ask which tip they want next"],
  notes: [],
  confidence: "low",
  createdAt: ago(240),
  pulse: null,
};

const tournament: TournamentOutput = {
  winnerIndex: 1,
  tooClose: false,
  margin: 9,
  confidence: "medium",
  summary:
    '"Lead with the waste" is the strongest. Owners stopped for the number in the first line.',
  variants: [
    {
      index: 0,
      ref: null,
      label: "Your original",
      title: "",
      body: "Fresh beans, delivered every week. Our café subscription keeps your hopper full and your regulars happy.",
      isOriginal: true,
      overall: 61,
      dimensions: dims(66, 52, 74, 62, 50),
      picked: 18,
      why: "Clear, but it could be any roaster.",
      rank: 3,
    },
    {
      index: 1,
      ref: null,
      label: "Lead with the waste",
      title: "",
      body: "The average café bins one bag in six.\n\nWe roast on Monday and deliver on Wednesday, in the amount you actually use. Want to see what you'd save? Ask us for a sample week.",
      isOriginal: false,
      overall: 79,
      dimensions: dims(84, 82, 78, 70, 76),
      picked: 52,
      why: "Owners stopped for the number in the first line.",
      rank: 1,
    },
    {
      index: 2,
      ref: null,
      label: "A regular's story",
      title: "",
      body: "Maya noticed her flat whites tasted flat by Friday. Now the beans arrive two days after roasting, and Friday tastes like Monday. Which day do your beans arrive?",
      isOriginal: false,
      overall: 70,
      dimensions: dims(76, 72, 70, 74, 60),
      picked: 30,
      why: "Managers liked hearing it from someone like them.",
      rank: 2,
    },
  ],
};

const run = (done: number): RunView => ({
  id: "r1",
  kind: "pulse",
  status: "running",
  stage: done >= 2 ? "summarizing" : "asking",
  progress: { done, total: 3 },
  contentItemId: "c1",
  events: [
    {
      kind: "group_answered",
      summary: "Independent café owners answered (8 simulated people).",
      at: ago(1),
    },
    ...(done >= 2
      ? [
          {
            kind: "group_answered",
            summary: "Café managers answered (8 simulated people).",
            at: ago(0),
          },
        ]
      : []),
  ].slice(0, Math.max(1, done)),
  error: null,
  prediction: null,
  tournament: null,
  createdAt: ago(1),
});

const base: AudienceView = {
  twins: [owners, managers],
  overall: {
    ...owners,
    id: "t0",
    slug: "overall",
    kind: "overall",
    name: "What your results show",
    traits: [
      makeTrait("pattern", "Carousels get more reactions than text posts.", "measured"),
      makeTrait("pattern", "Posts that open with a question get more reactions.", "measured"),
    ],
  },
  canBuild: true,
  canEdit: true,
  building: null,
  recent: [pulse, quick],
  accuracy: {
    measured: 11,
    compared: 9,
    averageGap: 12,
    learned: ["Carousels get more reactions than text posts."],
    outcomes: [
      {
        id: "o1",
        title: "Why your Friday coffee tastes flat",
        platform: "instagram",
        predicted: 78,
        actual: 84,
        views: 4210,
        measuredAt: ago(600),
      },
      {
        id: "o2",
        title: "Meet the roaster",
        platform: "linkedin",
        predicted: 66,
        actual: 41,
        views: 980,
        measuredAt: ago(2000),
      },
      {
        id: "o3",
        title: "Our new decaf",
        platform: "instagram",
        predicted: 59,
        actual: null,
        views: 310,
        measuredAt: ago(3000),
      },
    ],
  },
};

const empty: AudienceView = {
  ...base,
  twins: [],
  overall: null,
  recent: [],
  accuracy: { measured: 0, compared: 0, averageGap: null, learned: [], outcomes: [] },
};

const STATES = ["ready", "empty", "building", "viewer", "check", "compare"] as const;
type State = (typeof STATES)[number];

const handlers: AudienceHandlers = {
  build: () => undefined,
  saveGroup: () => undefined,
  removeGroup: () => undefined,
  cancelBuild: () => undefined,
  openBrandDna: () => undefined,
  busy: false,
};

export function AudienceLab() {
  const [state, setState] = useState<State>("ready");
  const [step, setStep] = useState(0);
  // Sample times are relative to now, so the screens render in the browser only.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("state") as State | null;
    if (fromUrl && STATES.includes(fromUrl)) setState(fromUrl);
    setMounted(true);
  }, []);

  // The check plays through: asking → summarising → result.
  useEffect(() => {
    setStep(0);
    if (state !== "check") return;
    const timers = [1, 2, 3].map((n) => window.setTimeout(() => setStep(n), n * 1400));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [state]);

  const view: AudienceView =
    state === "empty"
      ? empty
      : state === "viewer"
        ? { ...base, canEdit: false }
        : state === "building"
          ? {
              ...empty,
              building: {
                ...run(0),
                kind: "twins",
                stage: "reading",
                progress: { done: 0, total: 1 },
                events: [],
              },
            }
          : base;

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <nav className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-4 py-2">
        <span className="mr-2 text-[12px] font-medium text-muted-foreground">Audience lab</span>
        {STATES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setState(s)}
            className={cn(
              "h-7 rounded-full px-3 text-[12px] font-medium",
              s === state
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-foreground/80",
            )}
          >
            {s}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1">
        {!mounted ? null : state === "check" || state === "compare" ? (
          <div className="h-full overflow-y-auto">
            <div className="mx-auto max-w-[460px] space-y-3 p-4">
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                As shown in the editor <ScoreChip overall={quick.overall} />
              </p>
              <Tile>
                {state === "compare" ? (
                  <Ranking tournament={tournament} onUse={() => undefined} />
                ) : step < 3 ? (
                  <RunProgress run={run(step)} onCancel={() => undefined} />
                ) : (
                  <PredictionDetail prediction={pulse} compact />
                )}
              </Tile>
            </div>
          </div>
        ) : (
          <AudienceScreen key={state} view={view} handlers={handlers} />
        )}
      </div>
    </div>
  );
}
