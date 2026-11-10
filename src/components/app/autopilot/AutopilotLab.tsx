"use client";

// Development-only: the Autopilot screens with sample data, so layout and copy
// can be checked without a workspace or a sign-in. Mounted at /autopilot-lab.
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type {
  ActionView,
  AutopilotView,
  ProgramSettings,
  Strategy,
} from "@/lib/autopilot/contracts";
import type { PulseCampaign } from "@/lib/pulse/pulse";
import { ChatComposer } from "@/components/app/chat/ChatComposer";
import { AutopilotScreen, type AutopilotHandlers, type Section } from "./AutopilotScreen";
import { AutopilotHomeCard, type HomeAutopilotHandlers } from "./home/AutopilotHomeCard";

const HOUR = 3_600_000;
const at = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

const strategy: Strategy = {
  summary:
    "Show busy café owners that better beans and a simple subscription mean less waste and happier regulars.",
  audience: "Independent café owners and managers in the UK.",
  voice: "Warm, practical, a little dry",
  pillars: [
    { title: "Brewing know-how", detail: "One practical tip a barista can use on the next shift." },
    { title: "The subscription", detail: "How it works, what it saves, and who it suits." },
    { title: "Behind the roast", detail: "The people, the farms and the roasting days." },
    { title: "Café stories", detail: "What customers have changed, in their own words." },
  ],
};

const STORIES = {
  enabled: true,
  perDay: 1,
  days: [],
  windowStart: "09:00",
  windowEnd: "20:00",
  platforms: ["instagram" as const],
  themes: ["tip" as const, "behind" as const, "question" as const],
  frames: 3,
  smartTiming: true,
};

const settings: ProgramSettings = {
  mode: "full",
  goal: "leads",
  goalNote: "",
  platforms: ["linkedin", "instagram"],
  contentTypes: ["social", "carousel", "article"],
  postsPerWeek: 5,
  weekdays: [1, 2, 3, 4, 5],
  timezone: "Europe/London",
  weeks: 52,
  creditCapPerWeek: 90,
  videoCapPerWeek: 0,
  actOnOpportunities: true,
  strategy,
  automations: ["geo_scan", "repurpose", "weekly_report"],
  stories: STORIES,
};

const action = (over: Partial<ActionView>): ActionView => ({
  id: Math.random().toString(36).slice(2),
  kind: "content",
  status: "planned",
  plannedFor: at(24),
  platform: "linkedin",
  contentType: "social",
  title: "Why cold brew sells in winter",
  brief: "",
  reason: "",
  opportunityId: null,
  contentItemIds: [],
  creditsCharged: 12,
  approvedVia: null,
  error: null,
  metrics: null,
  updatedAt: at(-1),
  nextStepAt: at(3),
  ...over,
});

const running: AutopilotView = {
  enabled: true,
  fullAvailable: true,
  canEdit: true,
  canManage: true,
  program: {
    id: "p1",
    status: "running",
    pauseReason: null,
    mode: "full",
    goal: "leads",
    goalNote: "",
    platforms: ["linkedin", "instagram"],
    contentTypes: ["social", "carousel", "article"],
    postsPerWeek: 5,
    weekdays: [1, 2, 3, 4, 5],
    timezone: "Europe/London",
    startsOn: "2026-10-01",
    endsOn: "2027-09-29",
    creditCapPerWeek: 90,
    videoCapPerWeek: 0,
    actOnOpportunities: true,
    strategy,
    automations: ["geo_scan", "repurpose", "publish_articles", "weekly_report"],
    stories: STORIES,
    week: 2,
    totalWeeks: 52,
  },
  budget: { creditsUsed: 36, creditCap: 90, videosUsed: 0, videoCap: 0 },
  proposed: [],
  approvals: [
    action({
      status: "needs_approval",
      plannedFor: at(20),
      title: "The 2 a.m. roast that changed our house blend",
      reason: "It mentions a date Mellox couldn't find in your Brand DNA, so it waits for you.",
      builtFrom: [
        "Brand DNA",
        "For: Café owners",
        "Market: Home brewing is growing",
        "Stands apart from: Big Roast Co",
      ],
      preview: {
        contentItemId: "c1",
        status: "pending",
        title: "The 2 a.m. roast that changed our house blend",
        body: "Most roasters will tell you consistency is everything.\n\nWe agree. Which is why one night last spring we threw out a whole batch and started again.\n\nHere is what we changed, and why your flat whites taste the way they do now.",
        mediaUrl: null,
        channel: "linkedin",
        score: 78,
      },
    }),
  ],
  upcoming: [
    action({
      status: "scheduled",
      plannedFor: at(4),
      title: "Three questions to ask your roaster",
    }),
    action({
      status: "scheduled",
      plannedFor: at(28),
      platform: "instagram",
      title: "What a subscription really saves a 40-cover café",
    }),
    action({ status: "generating", plannedFor: at(52), title: "Milk temperature, in one picture" }),
    action({
      status: "planned",
      plannedFor: at(58),
      contentType: "carousel",
      title: "Why your grinder matters more than your machine (new format)",
    }),
    action({
      status: "planned",
      plannedFor: at(100),
      platform: null,
      contentType: "article",
      title: "How to choose a coffee subscription for a small café",
    }),
    action({
      status: "planned",
      plannedFor: at(76),
      platform: "instagram",
      title: "Meet Asha, who runs the roaster",
    }),
  ],
  finished: [
    action({
      status: "measured",
      plannedFor: at(-50),
      title: "Why your grinder matters more than your machine",
      metrics: { views: 1840 },
    }),
    action({
      status: "published",
      plannedFor: at(-26),
      platform: "instagram",
      title: "Friday roast day",
    }),
  ],
  failed: [],
  opportunities: [
    {
      id: "o1",
      kind: "competitor",
      title: "Beanhaus: launched a winter subscription box",
      summary: "Beanhaus announced a monthly winter box.",
      why: "Your own subscription is cheaper and ships faster, and you rarely say so.",
      suggestedAction: "Create a LinkedIn post showing how your subscription differs?",
      suggestedType: "social",
      suggestedPlatforms: ["linkedin"],
      evidence: [{ title: "Beanhaus blog", url: "https://example.com/beanhaus", date: null }],
      score: 84,
      status: "new",
      createdAt: at(-3),
      expiresAt: at(200),
    },
    {
      id: "o2",
      kind: "trend",
      title: "Cafés are switching to smaller, fresher bean orders",
      summary: "",
      why: "This is exactly the problem your subscription solves.",
      suggestedAction: "Create a carousel on ordering little and often?",
      suggestedType: "carousel",
      suggestedPlatforms: ["instagram"],
      evidence: [{ title: "Trade report", url: "https://example.com/report", date: null }],
      score: 71,
      status: "new",
      createdAt: at(-20),
      expiresAt: at(200),
    },
  ],
  events: [
    {
      id: "e1",
      kind: "piece_auto_approved",
      summary:
        "Approved automatically (it passed every check): Three questions to ask your roaster",
      actor: "system",
      actionId: null,
      createdAt: at(-2),
    },
    {
      id: "e2",
      kind: "piece_scheduled",
      summary: "Scheduled for Tue 6 Oct, 08:30: Three questions to ask your roaster",
      actor: "system",
      actionId: null,
      createdAt: at(-2),
    },
    {
      id: "e3",
      kind: "plan_ready",
      summary: "Planned 5 pieces for the week of 2026-10-05.",
      actor: "system",
      actionId: null,
      createdAt: at(-30),
    },
    {
      id: "e4",
      kind: "program_started",
      summary: "Autopilot started.",
      actor: "user",
      actionId: null,
      createdAt: at(-31),
    },
  ],
  connectedPlatforms: ["linkedin"],
  readiness: [
    {
      id: "accounts",
      ok: false,
      required: true,
      label: "Connect your social accounts",
      detail: "Not connected: instagram",
      cta: "Connect",
    },
    {
      id: "brand",
      ok: true,
      required: false,
      label: "Brand DNA ready",
      detail: "Posts are written from it",
      cta: "Add",
    },
    {
      id: "website",
      ok: true,
      required: false,
      label: "Website set",
      detail: "Checked every week for AI visibility",
      cta: "Add",
    },
    {
      id: "audience",
      ok: true,
      required: false,
      label: "Customer groups ready",
      detail: "Each post is written for one of them",
      cta: "Add",
    },
    {
      id: "competitors",
      ok: true,
      required: false,
      label: "Competitors tracked",
      detail: "Posts show what you do differently",
      cta: "Pick",
    },
    {
      id: "market",
      ok: false,
      required: false,
      label: "Read your market",
      detail: "So posts can respond to what is happening around you.",
      cta: "Open",
    },
  ],
  learnings: [
    'Best so far: "Why your grinder matters more than your machine" (1,840 views).',
    "LinkedIn reaches about 2.4× more people than Instagram.",
  ],
  tasks: [
    action({ kind: "task", status: "done", contentType: "geo_scan", platform: null }),
    action({
      kind: "task",
      status: "done",
      contentType: "repurpose",
      platform: null,
      updatedAt: at(-30),
    }),
    action({
      kind: "task",
      status: "done",
      contentType: "weekly_report",
      platform: null,
      updatedAt: at(-52),
    }),
  ],
  nextPlanAt: at(96),
  visibility: { score: 72, scannedAt: at(-30) },
  site: { host: "beanhaus.example" },
  week: { posted: 4, views: 5210, auto: 3 },
  stories: { enabled: true, times: ["12:30"], timing: "common", upcoming: 6, waiting: 0 },
};

const SCENES = [
  "setup",
  "home",
  "approvals",
  "ideas",
  "activity",
  "settings",
  "paused",
  "card",
] as const;
type Scene = (typeof SCENES)[number];

const notStarted: AutopilotView = {
  ...running,
  program: null,
  budget: null,
  approvals: [],
  upcoming: [],
  finished: [],
  opportunities: [],
  events: [],
  tasks: [],
  week: { posted: 0, views: 0, auto: 0 },
  readiness: running.readiness.map((r) => ({ ...r, ok: true })),
};
const pausedView: AutopilotView = {
  ...running,
  program: { ...running.program!, status: "paused", pauseReason: "user" },
};

/** Home's Autopilot card in every state, above a plain message box. */
function CardScene({ log }: { log: (name: string) => (...args: unknown[]) => void }) {
  const [paused, setPaused] = useState(false);
  const [value, setValue] = useState("");
  const handlers: HomeAutopilotHandlers = {
    open: log("open"),
    upgrade: log("upgrade"),
    pause: (next) => {
      log("pause")(next);
      setPaused(next);
    },
    place: log("place"),
    retry: log("retry"),
  };
  const planning: AutopilotView = {
    ...running,
    upcoming: [],
    approvals: [],
    proposed: [],
    finished: [],
  };
  return (
    <div className="mx-chat mx-auto flex max-w-[1040px] flex-col gap-5 px-4 pb-10 pt-8 md:px-8">
      <div data-testid="card-off">
        <AutopilotHomeCard state={{ kind: "off", canManage: true }} handlers={handlers} />
      </div>
      <div data-testid="card-live">
        <AutopilotHomeCard
          state={{ kind: "live", view: paused ? pausedView : running }}
          campaigns={CAMPAIGNS}
          handlers={handlers}
        />
      </div>
      <div data-testid="card-planning">
        <AutopilotHomeCard state={{ kind: "live", view: planning }} handlers={handlers} />
      </div>
      <div data-testid="card-locked">
        <AutopilotHomeCard state={{ kind: "locked", plan: "growth" }} handlers={handlers} />
      </div>
      <AutopilotHomeCard state={{ kind: "loading" }} handlers={handlers} />
      {/* The message box stays a message box: Autopilot never covers it. */}
      <div data-testid="box">
        <ChatComposer
          slim
          value={value}
          onChange={setValue}
          onSend={log("send")}
          onStop={() => {}}
          onAddFiles={() => {}}
          onRemoveAttachment={() => {}}
          attachments={[]}
          streaming={false}
          busy={false}
          modelId="mellox-flash"
          onModelChange={() => {}}
          placeholder="Ask Mox anything…"
        />
      </div>
    </div>
  );
}

const CAMPAIGNS: PulseCampaign[] = [
  { id: "c1", name: "Winter blend launch", phase: "Build-up", keyDate: at(24 * 9), waiting: 0 },
];

export function AutopilotLab() {
  const [scene, setScene] = useState<Scene>("setup");
  // Sample dates are relative to "now", so this page only renders in the browser.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("scene");
    if ((SCENES as readonly string[]).includes(wanted ?? "")) setScene(wanted as Scene);
    setMounted(true);
  }, []);
  const [last, setLast] = useState("");
  const log =
    (name: string) =>
    (...args: unknown[]) =>
      setLast(`${name} ${JSON.stringify(args).slice(0, 600)}`);

  const handlers: AutopilotHandlers = {
    start: log("start"),
    update: log("update"),
    pause: log("pause"),
    stop: log("stop"),
    approvePlan: log("approvePlan"),
    decide: log("decide"),
    retry: log("retry"),
    opportunity: log("opportunity"),
    open: log("open"),
    busy: false,
  };

  const view: AutopilotView =
    scene === "setup" ? notStarted : scene === "paused" ? pausedView : running;
  const section: Section =
    scene === "approvals" || scene === "ideas" || scene === "activity" || scene === "settings"
      ? scene
      : "home";

  if (!mounted) return null;
  return (
    <div data-mellox-app className="min-h-[100dvh] bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-3 py-2">
        {SCENES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScene(s)}
            className={cn(
              "rounded-full px-3 py-1 text-[12px] font-medium",
              s === scene ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {s}
          </button>
        ))}
        <span className="ml-auto truncate text-[11px] text-muted-foreground" data-testid="lab-last">
          {last}
        </span>
      </div>
      {scene === "card" && <CardScene log={log} />}
      <div
        hidden={scene === "card"}
        className="ds-window mx-auto my-4 h-[calc(100dvh-90px)] w-[min(1100px,calc(100vw-16px))] overflow-hidden"
        data-testid="autopilot-lab-frame"
      >
        <AutopilotScreen
          key={scene}
          view={view}
          handlers={handlers}
          initialSection={section}
          campaigns={CAMPAIGNS}
          suggestion={{
            data: { strategy, settings, source: "model", hasBrand: true },
            loading: false,
            failed: false,
          }}
        />
      </div>
    </div>
  );
}
