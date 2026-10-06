"use client";

// Development-only: the Autopilot screens with sample data, so layout and copy
// can be checked without a workspace or a sign-in. Mounted at /autopilot-lab.
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type {
  ActionView,
  AutopilotView,
  ProgramSettings,
  Strategy,
} from "@/lib/autopilot/contracts";
import { ChatComposer, type ChatComposerHandle } from "@/components/app/chat/ChatComposer";
import { AutopilotScreen, type AutopilotHandlers, type Section } from "./AutopilotScreen";
import { AutopilotBeacon, AutopilotDeck, AutopilotToggle } from "./composer/AutopilotDeck";

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
  contentTypes: ["social"],
  postsPerWeek: 5,
  weekdays: [1, 2, 3, 4, 5],
  timezone: "Europe/London",
  weeks: 52,
  creditCapPerWeek: 90,
  videoCapPerWeek: 0,
  actOnOpportunities: true,
  strategy,
  automations: ["geo_scan"],
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
    contentTypes: ["social"],
    postsPerWeek: 5,
    weekdays: [1, 2, 3, 4, 5],
    timezone: "Europe/London",
    startsOn: "2026-10-01",
    endsOn: "2027-09-29",
    creditCapPerWeek: 90,
    videoCapPerWeek: 0,
    actOnOpportunities: true,
    strategy,
    automations: ["geo_scan"],
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
      preview: {
        contentItemId: "c1",
        status: "pending",
        title: "The 2 a.m. roast that changed our house blend",
        body: "Most roasters will tell you consistency is everything.\n\nWe agree. Which is why one night last spring we threw out a whole batch and started again.\n\nHere is what we changed, and why your flat whites taste the way they do now.",
        mediaUrl: null,
        channel: "linkedin",
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
  ],
  learnings: [
    'Best so far: "Why your grinder matters more than your machine" (1,840 views).',
    "LinkedIn reaches about 2.4× more people than Instagram.",
  ],
  tasks: [action({ kind: "task", status: "done", contentType: "geo_scan", platform: null })],
  visibility: { score: 72, scannedAt: at(-30) },
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
  "box",
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
  readiness: running.readiness.map((r) => ({ ...r, ok: true })),
};
const pausedView: AutopilotView = {
  ...running,
  program: { ...running.program!, status: "paused", pauseReason: "user" },
};

/**
 * Autopilot in the chat message box: off (a switch), being set up, on (it
 * covers the box) and paused. `?box=on|paused|setup` starts at that step.
 */
function BoxScene({ log }: { log: (name: string) => (...args: unknown[]) => void }) {
  const [stage, setStage] = useState<"off" | "setup" | "on" | "paused">("off");
  const [typing, setTyping] = useState(false);
  const [value, setValue] = useState("");
  const composer = useRef<ChatComposerHandle>(null);
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("box");
    if (wanted === "on" || wanted === "paused" || wanted === "setup") setStage(wanted);
  }, []);
  const covered = stage !== "off" && !typing;
  const write = () => {
    setTyping(true);
    if (stage === "setup") setStage("off");
    requestAnimationFrame(() => composer.current?.focus());
  };

  return (
    <div className="mx-chat mx-auto flex max-w-3xl flex-col gap-6 px-3 pb-10 pt-10 md:px-6">
      <div className="flex h-8 items-center justify-end" data-testid="box-topbar">
        {(stage === "on" || stage === "paused") && (
          <AutopilotBeacon state={stage} waiting={stage === "on" ? 1 : 0} onClick={log("beacon")} />
        )}
      </div>
      <div data-testid="box">
        <ChatComposer
          ref={composer}
          hero
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
          placeholder="How can Mellox help today?"
          autopilot={covered ? stage : stage === "on" ? "on" : null}
          toolbarSlot={
            <AutopilotToggle
              state={stage === "setup" ? "off" : stage}
              waiting={stage === "on" ? 1 : 0}
              onClick={() => {
                if (stage === "off") setStage("setup");
                if (stage === "paused") setStage("on");
                setTyping(false);
              }}
            />
          }
          cover={
            covered ? (
              <AutopilotDeck
                view={stage === "on" ? running : stage === "paused" ? pausedView : notStarted}
                suggestion={{
                  data: { strategy, settings, source: "model", hasBrand: true },
                  loading: false,
                  failed: false,
                }}
                handlers={{
                  start: (...args) => {
                    log("start")(...args);
                    setStage("on");
                  },
                  pause: (paused) => {
                    log("pause")(paused);
                    setStage(paused ? "paused" : "on");
                  },
                  write,
                  open: log("open"),
                  fix: log("fix"),
                  retry: log("retry"),
                  busy: false,
                }}
              />
            ) : null
          }
        />
      </div>
    </div>
  );
}

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
      {scene === "box" && <BoxScene log={log} />}
      <div
        hidden={scene === "box"}
        className="ds-window mx-auto my-4 h-[calc(100dvh-90px)] w-[min(1100px,calc(100vw-16px))] overflow-hidden"
        data-testid="autopilot-lab-frame"
      >
        <AutopilotScreen
          key={scene}
          view={view}
          handlers={handlers}
          initialSection={section}
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
