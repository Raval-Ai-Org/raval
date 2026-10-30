"use client";

// /campaigns-lab (development only): the real CampaignsScreen with sample
// campaigns built by the real skeleton, so every view can be checked without
// signing in. Every handler writes its call into `lab-last`.
import { useEffect, useState } from "react";
import { dsGhostBtn } from "@/components/app/surface/buttons";
import { addDaysYmd } from "@/lib/autopilot/time";
import {
  type CampaignBrief,
  type CampaignStatus,
  type CampaignView,
  type CampaignsHome,
  type PieceState,
  type PieceView,
} from "@/lib/campaigns/contracts";
import { assignMedia, settleFormats } from "@/lib/campaigns/media";
import { playbookById } from "@/lib/campaigns/playbooks";
import { campaignProgress } from "@/lib/campaigns/progress";
import { buildCampaignSkeleton } from "@/lib/campaigns/skeleton";
import { cn } from "@/lib/utils";
import { CampaignsScreen } from "./CampaignsScreen";
import type { CampaignsHandlers, CampaignsMode, CampaignsTab, CampaignsView } from "./types";

const TODAY = "2026-11-02";
const SCENES = ["home", "home-empty", "running", "draft", "designer", "edit"] as const;
type Scene = (typeof SCENES)[number];

/** A soft picture drawn inline, so the lab needs no network. */
function art(seed: number): string {
  const hues = [
    [82, 160],
    [30, 350],
    [200, 260],
    [140, 60],
    [10, 45],
  ][seed % 5];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hues[0]} 70% 62%)"/><stop offset="1" stop-color="hsl(${hues[1]} 60% 30%)"/></linearGradient></defs><rect width="160" height="160" fill="url(#g)"/><circle cx="${40 + ((seed * 23) % 80)}" cy="${50 + ((seed * 17) % 60)}" r="34" fill="white" fill-opacity="0.18"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const MEDIA_IDS = Array.from(
  { length: 5 },
  (_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`,
);
const MEDIA_URLS = Object.fromEntries(MEDIA_IDS.map((id, i) => [id, art(i + 3)]));

const TITLES: Record<string, string[]> = {
  tease: ["Something warm is coming", "Guess the colour", "Three days to go"],
  reveal: ["Meet the Ember range"],
  launch: ["It's here: Ember", "Why we made it"],
  proof: ["What early customers said", "How to style it"],
  "last-call": ["Last week of launch pricing"],
  "warm-up": ["Cold mornings, sorted"],
  main: ["Winter's favourite", "Our coziest picks"],
  "last-chance": ["Last chance before it's gone"],
  thanks: ["Thank you for a warm season"],
};

function makeCampaign(args: {
  id: string;
  type: string;
  name: string;
  status: CampaignStatus;
  startsOn: string;
  keyDate: string | null;
  weeks?: number;
  channels: CampaignBrief["channels"];
  pace?: CampaignBrief["pace"];
  written: boolean;
  media?: boolean;
  goal?: Partial<CampaignBrief["goal"]>;
  bigIdea?: string;
}): CampaignView {
  const playbook = playbookById(args.type)!;
  const brief: CampaignBrief = {
    type: args.type,
    name: args.name,
    about: "A new range of hand-poured candles for winter evenings.",
    keyMessage: "Warmth you can give.",
    offer: "",
    facts: ["Hand-poured in Leeds", "Burns for 40 hours"],
    keyDate: args.keyDate,
    startsOn: args.startsOn,
    weeks: args.weeks ?? 3,
    channels: args.channels,
    pace: args.pace ?? "steady",
    stories: true,
    timezone: "Europe/London",
    hashtag: "",
    tone: "",
    goal: {
      kind: playbook.goal,
      target: null,
      link: null,
      linkLabel: "",
      count: null,
      countAt: null,
      ...args.goal,
    },
    productIds: [],
    media: args.media
      ? MEDIA_IDS.map((assetId, i) => ({
          assetId,
          kind: "image" as const,
          role: (["hero", "detail", "detail", "people", "any"] as const)[i],
          label: "",
        }))
      : [],
  };
  // Built as of the day before it started, then read as of the lab's today.
  const skeleton = buildCampaignSkeleton(playbook, brief, [], addDaysYmd(args.startsOn, -1));
  const placed = assignMedia(
    playbook,
    settleFormats(playbook, skeleton.pieces, brief.media),
    brief.media,
  );
  const live = args.status === "running" || args.status === "paused" || args.status === "done";
  const counters: Record<string, number> = {};
  const pieces: PieceView[] = placed.map((p, i) => {
    const n = (counters[p.phase] = (counters[p.phase] ?? -1) + 1);
    const titles = TITLES[p.phase] ?? ["A post for this step"];
    let state: PieceState = args.written ? "planned" : "idea";
    if (live) {
      if (p.date < TODAY || args.status === "done") state = "out";
      else if (p.date === TODAY) state = i % 2 ? "waiting" : "making";
      else if (p.date === addDaysYmd(TODAY, 1)) state = "waiting";
      else state = "planned";
    }
    const made = state === "out" || state === "waiting";
    return {
      ...p,
      title: args.written ? (p.format === "story" ? "Countdown" : titles[n % titles.length]) : "",
      idea:
        args.written && p.format !== "story"
          ? "Close on the flame, slow pour, one line about why winter evenings deserve better light."
          : "",
      state,
      actionId: live ? `act-${i}` : null,
      contentIds: made ? [`content-${args.id}-${i}`] : [],
      thumb: made ? art(i) : null,
      views: state === "out" ? 400 + ((i * 137) % 900) : null,
      error: null,
    };
  });
  const progress = campaignProgress(pieces);
  return {
    id: args.id,
    type: args.type,
    name: args.name,
    status: args.status,
    brief,
    plan: {
      v: 1,
      bigIdea: args.bigIdea ?? "",
      phases: skeleton.phases,
      pieces,
      written: args.written,
      rev: 0,
    },
    goal: brief.goal,
    startsOn: skeleton.startsOn,
    endsOn: skeleton.endsOn,
    keyDate: skeleton.keyDate,
    version: 1,
    pieces,
    progress,
    updatedAt: `${TODAY}T09:00:00Z`,
    mediaUrls: MEDIA_URLS,
  };
}

function sampleHome(empty: boolean): CampaignsHome {
  const campaigns = empty
    ? []
    : [
        makeCampaign({
          id: "11111111-1111-4111-8111-111111111111",
          type: "product-launch",
          name: "The Ember range",
          status: "running",
          startsOn: "2026-10-22",
          keyDate: "2026-11-06",
          channels: ["instagram", "facebook", "linkedin"],
          written: true,
          media: true,
          goal: {
            target: 500,
            count: 128,
            countAt: "2026-11-01T10:00:00Z",
            link: "https://example.com/ember",
          },
          bigIdea:
            "Every evening deserves a little ceremony: Ember turns lighting a candle into the moment the day ends.",
        }),
        makeCampaign({
          id: "22222222-2222-4222-8222-222222222222",
          type: "seasonal",
          name: "Winter warmers",
          status: "running",
          startsOn: "2026-10-28",
          keyDate: null,
          weeks: 5,
          pace: "light",
          channels: ["instagram", "tiktok"],
          written: true,
        }),
        makeCampaign({
          id: "33333333-3333-4333-8333-333333333333",
          type: "event",
          name: "Candle-making evening",
          status: "ready",
          startsOn: "2026-11-09",
          keyDate: "2026-11-28",
          channels: ["instagram", "facebook"],
          written: true,
          goal: { target: 40, link: "https://example.com/book" },
        }),
        makeCampaign({
          id: "44444444-4444-4444-8444-444444444444",
          type: "sale",
          name: "Black Friday",
          status: "draft",
          startsOn: "2026-11-20",
          keyDate: "2026-11-27",
          channels: ["instagram"],
          written: false,
        }),
        makeCampaign({
          id: "55555555-5555-4555-8555-555555555555",
          type: "teach",
          name: "Candle care tips",
          status: "done",
          startsOn: "2026-09-01",
          keyDate: null,
          weeks: 3,
          channels: ["instagram"],
          written: true,
        }),
      ];
  const everyday = Array.from({ length: 16 }, (_, i) => ({
    date: addDaysYmd(TODAY, 1 + i * 3),
    platform: i % 2 ? "linkedin" : "instagram",
    title: "Everyday post",
  }));
  return {
    campaigns,
    suggestions: empty
      ? []
      : [
          {
            id: "s1",
            type: "seasonal",
            title: "Christmas",
            why: "In 7 weeks. Gift guides and last order dates do well.",
            source: "moment",
            brief: { name: "Christmas gifting" },
          },
          {
            id: "s2",
            type: "lead-magnet",
            title: "A free care guide",
            why: "Your goal is more leads. A useful download brings sign-ups.",
            source: "goal",
            brief: { name: "Free care guide" },
          },
          {
            id: "s3",
            type: "social-proof",
            title: "Customer stories",
            why: "You haven't shown a review in a while.",
            source: "evergreen",
            brief: { name: "What customers say" },
          },
        ],
    everyday,
    autopilot: { running: !empty, mode: "approve" },
    canPlan: true,
    price: { plan: 55, write: 7 },
  };
}

export function CampaignsLab() {
  const [scene, setScene] = useState<Scene>("home");
  const [ready, setReady] = useState(false);
  const [dark, setDark] = useState(false);
  const [last, setLast] = useState("");
  const [home, setHome] = useState<CampaignsHome>(() => sampleHome(false));
  const [mode, setMode] = useState<CampaignsMode>({ kind: "home" });
  const [tab, setTab] = useState<CampaignsTab>("overview");

  function pick(next: Scene) {
    setScene(next);
    const h = sampleHome(next === "home-empty");
    setHome(h);
    setTab("overview");
    setMode(
      next === "running"
        ? { kind: "campaign", id: h.campaigns[0].id }
        : next === "draft"
          ? { kind: "campaign", id: h.campaigns[3].id }
          : next === "designer"
            ? { kind: "new" }
            : next === "edit"
              ? { kind: "new", type: "event", editId: h.campaigns[2].id }
              : { kind: "home" },
    );
  }

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("scene");
    pick((SCENES as readonly string[]).includes(s ?? "") ? (s as Scene) : "home");
    setReady(true);
  }, []);

  const log = (s: string) => setLast(s);
  const patch = (id: string, fn: (c: CampaignView) => CampaignView) =>
    setHome((h) => ({ ...h, campaigns: h.campaigns.map((c) => (c.id === id ? fn(c) : c)) }));
  const openId = mode.kind === "campaign" ? mode.id : mode.kind === "new" ? mode.editId : null;

  const handlers: CampaignsHandlers = {
    go: (next) => {
      log(
        `go:${next.kind}${next.kind === "campaign" ? `:${next.id.slice(0, 4)}` : next.kind === "new" ? `:${next.type ?? ""}` : ""}`,
      );
      setMode(next);
    },
    tab: (t) => {
      log(`tab:${t}`);
      setTab(t);
    },
    save: async (brief, id) => {
      log(`save:${brief.name}`);
      const existing = home.campaigns.find((c) => c.id === id);
      const c = makeCampaign({
        id: id ?? "66666666-6666-4666-8666-666666666666",
        type: brief.type,
        name: brief.name || "Untitled",
        status: existing?.status ?? "draft",
        startsOn: brief.startsOn,
        keyDate: brief.keyDate ?? null,
        weeks: brief.weeks,
        channels: brief.channels as CampaignBrief["channels"],
        pace: brief.pace,
        written: existing?.plan.written ?? false,
      });
      setHome((h) => ({ ...h, campaigns: [c, ...h.campaigns.filter((x) => x.id !== c.id)] }));
      return c;
    },
    write: async (args) => {
      log(`write:${args.type}`);
      return {
        name: args.name || "Winter open evening",
        about: "An evening of making your own candle, with mulled cider.",
        keyMessage: "Make something warm.",
      };
    },
    plan: async (id) => {
      log(`plan:${id.slice(0, 4)}`);
      patch(id, (c) => ({ ...c, status: "ready", plan: { ...c.plan, written: true } }));
    },
    start: (id) => {
      log(`start:${id.slice(0, 4)}`);
      patch(id, (c) => ({ ...c, status: "running" }));
    },
    pause: (id, paused) => {
      log(`${paused ? "pause" : "resume"}:${id.slice(0, 4)}`);
      patch(id, (c) => ({ ...c, status: paused ? "paused" : "running" }));
    },
    end: (id) => {
      log(`end:${id.slice(0, 4)}`);
      patch(id, (c) => ({ ...c, status: "ended" }));
    },
    count: (id, count) => {
      log(`count:${count}`);
      patch(id, (c) => ({ ...c, goal: { ...c.goal, count, countAt: `${TODAY}T12:00:00Z` } }));
    },
    editPiece: (_id, pieceId, p) => log(`piece:${pieceId}:${Object.keys(p).join(",")}`),
    remove: (id) => {
      log(`remove:${id.slice(0, 4)}`);
      setHome((h) => ({ ...h, campaigns: h.campaigns.filter((c) => c.id !== id) }));
      setMode({ kind: "home" });
    },
    upload: async (files) => {
      log(`upload:${files.length}`);
      return [];
    },
    openCalendar: () => log("calendar"),
    openPiece: (id) => log(`piece-open:${id}`),
    openAutopilot: () => log("autopilot"),
  };

  const view: CampaignsView = {
    home,
    selected: openId ? (home.campaigns.find((c) => c.id === openId) ?? null) : null,
    today: TODAY,
    timezone: "Europe/London",
    canEdit: true,
    products: [
      { id: "77777777-7777-4777-8777-777777777771", name: "Ember candle", thumb: art(1) },
      { id: "77777777-7777-4777-8777-777777777772", name: "Gift box", thumb: art(2) },
    ],
    mediaUrls: MEDIA_URLS,
    busy: null,
  };

  return (
    <div
      data-mellox-app
      className={cn("min-h-screen bg-background text-foreground", dark && "dark")}
    >
      <div className="mx-auto max-w-[1280px] space-y-4 p-3 sm:p-6">
        <div className="flex flex-wrap items-center gap-1.5">
          {SCENES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => pick(s)}
              aria-pressed={scene === s}
              className={cn(dsGhostBtn, "h-8 px-3 text-[12px]", scene === s && "border-primary/60")}
            >
              {s}
            </button>
          ))}
          <button
            type="button"
            className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
            onClick={() => setDark((d) => !d)}
          >
            {dark ? "Light" : "Dark"}
          </button>
          <span
            className="ml-auto font-mono text-[11px] text-muted-foreground"
            data-testid="lab-last"
          >
            {last}
          </span>
        </div>
        <div
          className="ds-window h-[min(860px,calc(100vh-120px))] overflow-hidden"
          data-testid="campaigns-lab-frame"
        >
          {ready && (
            <div data-testid="campaigns-screen" className="h-full">
              <CampaignsScreen view={view} mode={mode} tab={tab} handlers={handlers} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
