"use client";

// Development-only: the Brain screens with sample data, so layout, motion and
// copy can be checked without a workspace or a sign-in. Mounted at /brain-lab.
import { useEffect, useState } from "react";
import { emptyDna, type BrandDna } from "@/hooks/use-brand-dna";
import { newsSince, type BrainOverview, type BrainSection } from "@/lib/brain/brain";
import type { MarketingStrategy, StrategyView } from "@/lib/strategy/contracts";
import { cn } from "@/lib/utils";
import { BrainHome } from "./BrainHome";
import { BrainIcon, BrainMark } from "./BrainMark";
import { BrainPulseView } from "./BrainPulse";
import { ScanSteps } from "./brand/ScanSteps";
import { LookEditor } from "./brand/look/LookEditor";
import { NotesBoard } from "./home/NotesBoard";
import { StrategyScreen, type StrategyHandlers } from "./strategy/StrategyScreen";

const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

const strategy: MarketingStrategy = {
  v: 1,
  positioning: {
    statement:
      "Northside Roasters gives independent cafés better beans on a simple subscription, so they waste less and keep their regulars.",
    promise: "Fresh beans every week, nothing thrown away",
    differentiators: ["Roasted to order", "Pause any week", "Barista support"],
  },
  goal: {
    type: "leads",
    summary: "Bring in more café owners asking for a trial box.",
    metric: "Trial box requests",
    target: "40 a month",
  },
  audiences: [
    {
      name: "Café owners",
      why: "They decide the supplier",
      message: "Less waste, happier regulars",
    },
    {
      name: "Head baristas",
      why: "They push for better beans",
      message: "Beans you'll be proud to pull",
    },
  ],
  voice: "Warm, practical, a little dry",
  pillars: [
    {
      title: "Brewing know-how",
      detail: "One tip a barista can use on the next shift.",
      share: 35,
    },
    { title: "The subscription", detail: "How it works and what it saves.", share: 25 },
    { title: "Behind the roast", detail: "The people, farms and roasting days.", share: 20 },
    { title: "Café stories", detail: "What customers changed, in their words.", share: 20 },
  ],
  channels: [
    {
      platform: "instagram",
      role: "Show the craft",
      perWeek: 4,
      formats: ["carousel", "story", "video"],
    },
    { platform: "linkedin", role: "Reach owners", perWeek: 2, formats: ["post", "image"] },
    { platform: "website", role: "Answer search questions", perWeek: 1, formats: ["article"] },
  ],
  messages: {
    attract: "Your beans are costing you more than you think.",
    convince: "Cafés on the plan throw away a third less.",
    convert: "Try a week free. Pause any time.",
    keep: "New roast every month, picked for your menu.",
  },
  competitors: [
    {
      competitorId: "11111111-1111-4111-8111-111111111111",
      name: "Bean Bros",
      theirAngle: "Cheapest bulk bags",
      ourEdge: "Fresher, smaller drops that match what a café really sells.",
    },
    {
      competitorId: "22222222-2222-4222-8222-222222222222",
      name: "Daily Grind Supply",
      theirAngle: "Big range, long contracts",
      ourEdge: "No contract and a real barista on the phone.",
    },
  ],
  plays: [
    {
      title: "Answer “how much coffee does a café waste”",
      detail: "Searches are rising and nobody local answers it well.",
      sourceUrl: "https://example.com/cafe-waste-report",
      sourceTitle: "Café waste report",
    },
  ],
  roadmap: [
    {
      phase: "Days 1–30",
      focus: "Set the base",
      actions: ["Post 6 times a week", "Publish the waste guide"],
    },
    {
      phase: "Days 31–60",
      focus: "Prove it",
      actions: ["Share three café stories", "Start the trial offer"],
    },
    {
      phase: "Days 61–90",
      focus: "Scale what works",
      actions: ["Double the best format", "Add a monthly video"],
    },
  ],
  kpis: [
    { label: "Trial requests", target: "40 / month", why: "The goal" },
    { label: "Saves per post", target: "25", why: "Shows useful content" },
    { label: "Profile visits", target: "1,200 / month", why: "Top of the path" },
    { label: "Reply rate", target: "8%", why: "Owners talking back" },
  ],
  rules: {
    do: ["Lead with the saving", "Show real cafés"],
    dont: ["No coffee snobbery", "Never name a competitor"],
  },
};

const overview: BrainOverview = {
  brains: {
    brand: {
      ready: true,
      health: 86,
      headline: "Better beans on a simple subscription for independent cafés.",
      updatedAt: ago(30),
      enabled: true,
      facts: ["5 colours", "Look set"],
    },
    audience: {
      ready: true,
      health: 70,
      headline: "Café owners · Head baristas",
      updatedAt: ago(52),
      enabled: true,
      facts: ["2 groups", "3 real results"],
    },
    competitors: {
      ready: true,
      health: 80,
      headline: "Bean Bros: New 5kg bulk bag at a lower price",
      updatedAt: ago(3),
      enabled: true,
      facts: ["3 tracked", "2 suggested"],
    },
    market: {
      ready: true,
      health: 100,
      headline: "Cafés are cutting waste as bean prices climb.",
      updatedAt: ago(6),
      enabled: true,
      facts: ["12 sources"],
    },
  },
  strategy: {
    status: "confirmed",
    stale: false,
    updatedAt: ago(20),
    pillars: strategy.pillars.map((p) => ({ title: p.title, share: p.share })),
    headline: strategy.positioning.statement,
  },
  updates: [
    {
      id: "c1",
      brain: "competitors",
      title: "Bean Bros: New 5kg bulk bag at a lower price",
      detail: "Aimed at high-volume cafés.",
      at: ago(3),
      url: "https://example.com/bean-bros",
    },
    {
      id: "m1",
      brain: "market",
      title: "Rising: cafés cutting waste",
      detail: "Bean prices up again.",
      at: ago(6),
    },
    { id: "m2", brain: "market", title: "Opening: local waste guides", at: ago(6) },
    { id: "s1", brain: "strategy", title: "Strategy confirmed", at: ago(20) },
    { id: "b1", brain: "brand", title: "Brand DNA updated", at: ago(30) },
    { id: "a1", brain: "audience", title: "Café owners group updated", at: ago(52) },
  ],
  needs: [
    {
      id: "competitors",
      brain: "competitors",
      label: "Pick competitors (2)",
      cta: "Pick",
    },
  ],
  generatedAt: new Date().toISOString(),
};

const emptyOverview: BrainOverview = {
  brains: {
    brand: {
      ready: false,
      health: 0,
      headline: "Not set up yet",
      updatedAt: null,
      enabled: true,
      facts: [],
    },
    audience: {
      ready: false,
      health: 0,
      headline: "No groups yet",
      updatedAt: null,
      enabled: true,
      facts: [],
    },
    competitors: {
      ready: false,
      health: 0,
      headline: "Nobody tracked yet",
      updatedAt: null,
      enabled: true,
      facts: [],
    },
    market: {
      ready: false,
      health: 0,
      headline: "Not checked yet",
      updatedAt: null,
      enabled: true,
      facts: [],
    },
  },
  strategy: { status: null, stale: false, updatedAt: null, pillars: [], headline: "" },
  updates: [],
  needs: [
    { id: "brand", brain: "brand", label: "Add your website", cta: "Open" },
    { id: "audience", brain: "audience", label: "Build audience groups", cta: "Build" },
    { id: "competitors", brain: "competitors", label: "Find competitors", cta: "Find" },
    { id: "market", brain: "market", label: "Check your market", cta: "Check" },
  ],
  generatedAt: new Date().toISOString(),
};

const ALL = { brand: true, audience: true, competitors: true, market: true };

function view(patch: Partial<StrategyView>): StrategyView {
  return {
    strategy,
    status: "confirmed",
    version: 3,
    generatedAt: ago(48),
    confirmedAt: ago(20),
    updatedAt: ago(20),
    stale: false,
    builtFrom: ALL,
    available: ALL,
    canEdit: true,
    nextIsFree: false,
    ...patch,
  };
}

const SCENES = [
  "home",
  "home-empty",
  "strategy",
  "strategy-draft",
  "strategy-empty",
  "strategy-writing",
  "pulse",
  "look",
  "notes",
  "scan",
  "marks",
] as const;
type Scene = (typeof SCENES)[number];

const sampleDna: BrandDna = {
  ...emptyDna,
  brandName: "Northside Roasters",
  voice: "Warm, practical, a little dry",
  colors: [
    { name: "Primary", hex: "#1f3d2b" },
    { name: "Accent", hex: "#e9a23b" },
    { name: "Background", hex: "#f6f1e7" },
    { name: "Text", hex: "#1b1b1b" },
  ],
  fonts: ["Fraunces", "Inter"],
};

export function BrainLab() {
  const [scene, setScene] = useState<Scene>("home");
  const [last, setLast] = useState<string>("");
  const [pulseOpen, setPulseOpen] = useState(true);
  const [dna, setDna] = useState<BrandDna>(sampleDna);
  // Set once the page is interactive and on the scene the URL asked for.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("scene");
    if (wanted && (SCENES as readonly string[]).includes(wanted)) setScene(wanted as Scene);
    setReady(true);
  }, []);

  const open = (section: BrainSection) => setLast(`open:${section}`);
  const handlers: StrategyHandlers = {
    generate: (note) => setLast(`generate:${note ?? ""}`),
    save: (s, confirm) =>
      setLast(`save:${confirm}:${JSON.stringify(s.pillars.map((p) => p.share))}`),
    openBrain: (brain) => setLast(`open:${brain}`),
    generating: scene === "strategy-writing",
    saving: false,
  };
  const seenAt = Date.now() - 10 * HOUR;

  return (
    <div data-mellox-app className="min-h-dvh bg-background text-foreground">
      <div className="sticky top-0 z-40 flex flex-wrap items-center gap-1.5 border-b border-border/60 bg-background/90 px-3 py-2 backdrop-blur">
        <BrainIcon size={18} />
        {SCENES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScene(s)}
            className={cn(
              "rounded-full px-3 py-1 text-[12px] font-medium",
              scene === s
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {s}
          </button>
        ))}
        <span data-testid="lab-last" className="ml-auto truncate text-[11px] text-muted-foreground">
          {last}
        </span>
      </div>

      <div data-testid="brain-lab-frame" data-ready={ready}>
        {scene === "home" && (
          <BrainHome overview={overview} news={newsSince(overview.updates, seenAt)} onOpen={open} />
        )}
        {scene === "home-empty" && (
          <BrainHome
            overview={emptyOverview}
            news={newsSince([], null)}
            locked={{ audience: "Growth" }}
            onOpen={open}
          />
        )}
        {scene === "strategy" && <StrategyScreen view={view({})} handlers={handlers} />}
        {scene === "strategy-draft" && (
          <StrategyScreen
            view={view({ status: "draft", confirmedAt: null, stale: true })}
            handlers={handlers}
          />
        )}
        {scene === "strategy-empty" && (
          <StrategyScreen
            view={view({
              strategy: null,
              status: null,
              version: 0,
              nextIsFree: true,
              available: { ...ALL, audience: false },
            })}
            handlers={handlers}
          />
        )}
        {scene === "strategy-writing" && <StrategyScreen view={view({})} handlers={handlers} />}
        {scene === "pulse" && (
          <div className="flex min-h-[70dvh] justify-end p-4">
            <BrainPulseView
              overview={overview}
              news={newsSince(overview.updates, seenAt)}
              seenAt={seenAt}
              open={pulseOpen}
              onToggle={() => setPulseOpen((v) => !v)}
              onOpenBrain={open}
            />
          </div>
        )}
        {scene === "look" && (
          <div className="mx-auto max-w-[1100px] p-4 sm:p-7">
            <LookEditor dna={dna} save={(patch) => setDna((d) => ({ ...d, ...patch }))} />
          </div>
        )}
        {scene === "notes" && (
          <div className="mx-auto max-w-[1040px] px-4 pt-5 sm:px-6">
            <NotesBoard workspaceId="00000000-0000-4000-8000-0000000000ab" />
          </div>
        )}
        {scene === "scan" && (
          <div className="space-y-4 p-6">
            <ScanSteps brand="running" audience="idle" competitors="idle" />
            <ScanSteps brand="done" audience="running" competitors="running" />
            <ScanSteps brand="done" audience="done" competitors="done" />
            <ScanSteps brand="done" audience="skipped" competitors="done" />
          </div>
        )}
        {scene === "marks" && (
          <div className="flex flex-wrap items-end gap-8 p-8">
            {(["brand", "audience", "competitors", "market"] as const).map((b, i) => (
              <div key={b} className="flex flex-col items-center gap-3">
                <BrainMark brain={b} size={96} delay={i * 0.15} />
                <BrainMark brain={b} size={40} active />
                <BrainMark brain={b} size={18} muted />
                <span className="text-[12px] text-muted-foreground">{b}</span>
              </div>
            ))}
            <BrainIcon size={64} />
          </div>
        )}
      </div>
    </div>
  );
}
