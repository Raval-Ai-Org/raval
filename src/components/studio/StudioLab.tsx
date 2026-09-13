"use client";

import { useEffect, useMemo, useState } from "react";
import { PipelineSection } from "@/components/app/StudioRail";
import { groupRows, type ContentRow } from "@/lib/studio/content-groups";
import { LibraryPage } from "@/components/app/LibraryPage";
import { LibraryDialog } from "@/components/app/LibraryDialog";
import { emitAppEvent } from "@/lib/app-events";
import { normalizeLibraryAsset } from "@/lib/library";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import { STUDIO_FORMATS, type StudioType } from "@/lib/studio/formats";
import { getTemplate, templatesFor } from "@/lib/studio/templates";
import type { StudioIdea } from "@/lib/studio/ideas";
import type { MediaOutput, StudioJob, StudioJobOutput } from "@/lib/studio/jobs";
import type { SessionStep, StudioSession } from "@/lib/studio/session-store";
import { ComposerBody } from "./StudioComposer";
import { DockCard } from "./StudioDock";
import type { ReviewRow } from "./ReviewPanel";

/* Sample data — deliberately realistic so layout problems show up. */

const WS = "00000000-0000-4000-8000-000000000000";

function art(w: number, h: number, a: string, b: string, label: string) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='100%' height='100%' fill='url(#g)'/><circle cx='${w * 0.7}' cy='${h * 0.35}' r='${Math.min(w, h) * 0.22}' fill='rgba(255,255,255,0.18)'/><text x='50%' y='88%' font-family='system-ui' font-size='${Math.round(w / 18)}' fill='white' text-anchor='middle' opacity='0.85'>${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const IDEAS: StudioIdea[] = [
  {
    id: "i1",
    type: "carousel",
    title: "5 signs your cold brew is under-extracted",
    why: "Searches for 'bitter cold brew' are up 40% this month.",
    brief:
      "A practical carousel that helps home brewers diagnose weak cold brew, ending with our brew guide.",
    platforms: ["instagram"],
    source: "trend",
    goal: "education",
  },
  {
    id: "i2",
    type: "ad",
    title: "Holiday gift subscriptions, delivered monthly",
    why: "Black Friday is in 22 days — gift buyers start planning now.",
    brief: "Ad variants for our 3-month gift subscription aimed at last-minute gifters.",
    platforms: ["facebook", "instagram"],
    source: "season",
    goal: "offer",
  },
  {
    id: "i3",
    type: "social",
    title: "Why we pay farmers 30% above fair trade",
    why: "No values-led posts in the last 3 weeks.",
    brief: "A story post about our sourcing model and the Huila co-op we buy from.",
    platforms: ["linkedin", "instagram"],
    source: "pillar",
    goal: "awareness",
  },
  {
    id: "i4",
    type: "article",
    title: "Decaf that doesn't taste like decaf: a buyer's guide",
    why: "Competitor launched a decaf line; we have no decaf content.",
    brief: "An article explaining Swiss Water decaf and how to choose a good one.",
    platforms: [],
    source: "competitor",
    goal: "education",
  },
];

const BASE_JOB = {
  workspace_id: WS,
  status: "succeeded" as const,
  stage: "polish" as const,
  stage_at: new Date().toISOString(),
  error: null,
  group_id: "g1",
  parent_job_id: null,
  asset_ids: [],
  attempt: 2,
  idempotency_key: "lab",
  created_at: new Date(Date.now() - 20_000).toISOString(),
  updated_at: new Date().toISOString(),
  completed_at: new Date().toISOString(),
};

const ready = (url: string, ratio: MediaOutput["ratio"]): MediaOutput => ({
  slot: "main",
  kind: "image",
  ratio,
  status: "ready",
  url,
  assetId: "a1",
  storagePath: "x",
});

const OUTPUTS: Partial<Record<StudioType, StudioJobOutput>> = {
  social: {
    title: "Pay the farmer, taste the difference",
    angle: "Behind the scenes",
    variants: [
      {
        platform: "linkedin",
        title: "Sourcing",
        body: "We pay the Huila co-op 30% above fair-trade minimums.\n\nNot as charity — as quality control. When farmers can afford to pick only ripe cherries, the cup is sweeter, cleaner, and more consistent.\n\nThree things changed when we moved to direct trade:\n→ Defect rates dropped by half\n→ We could plan roasts a season ahead\n→ Our farmers started experimenting with anaerobic lots\n\nWhat's one supplier relationship that changed your product?",
        hashtags: ["#specialtycoffee", "#directtrade", "#sourcing"],
        chars: 520,
      },
      {
        platform: "instagram",
        title: "Sourcing",
        body: "Ripe cherries only. 🍒\nThat's what paying 30% above fair trade buys.\n\nMeet the Huila co-op behind this month's roast → link in bio.\n\n#specialtycoffee #directtrade #coffeefarmers #huila",
        hashtags: [],
        chars: 170,
      },
    ],
    media: [ready(art(1080, 1080, "#3f5a1a", "#9fbf3b", "Huila, Colombia"), "1:1")],
    partial: [],
  },
  carousel: {
    title: "Is your cold brew under-extracted?",
    angle: "Checklist",
    slides: [
      { heading: "Is your cold brew under-extracted?", body: "5 signs, and the fix for each." },
      {
        heading: "It tastes sour, not sweet",
        body: "Steep 2–4 hours longer, or grind a notch finer.",
      },
      { heading: "It's thin and watery", body: "Use a 1:8 ratio instead of 1:12 for concentrate." },
      { heading: "The finish disappears", body: "Coarse grinds + short steeps skip the sugars." },
      { heading: "Save this for your next batch", body: "Our full cold brew guide is in the bio." },
    ],
    variants: [
      {
        platform: "instagram",
        title: "Cold brew",
        body: "Sour cold brew? It's probably under-extracted. Swipe for the 5 signs and how to fix each. 🧊\n\n#coldbrew #homebarista",
        hashtags: [],
        chars: 110,
      },
    ],
    media: [],
  },
  article: {
    title: "Decaf that doesn't taste like decaf: a buyer's guide",
    angle: "Practical how-to",
    article: {
      title: "Decaf that doesn't taste like decaf: a buyer's guide",
      dek: "How modern decaffeination works, and the three things to check before you buy.",
      metaDescription:
        "Swiss Water, sugarcane or CO₂? How each decaf process affects flavour, and how to pick a decaf that still tastes like great coffee.",
      takeaways: [
        "Process matters more than origin for decaf flavour.",
        "Look for a roast date within the last 3 weeks.",
        "Swiss Water and sugarcane (EA) decafs keep the most sweetness.",
      ],
      markdown:
        'Most people who say they hate decaf have only had old, over-roasted decaf. The good news: decaffeination has changed a lot.\n\n## How decaf is made\n\nCaffeine is removed from **green** coffee before roasting. The method determines how much flavour survives.\n\n- **Swiss Water** — water and carbon filters, no solvents.\n- **Sugarcane (EA)** — a natural solvent from fermented sugarcane.\n- **CO₂** — pressurised carbon dioxide; common for large lots.\n\n## What to check before you buy\n\n1. The process on the label.\n2. A recent roast date.\n3. A lighter roast profile.\n\n## The bottom line\n\nA good decaf should taste like its origin first and "decaf" never.',
      wordCount: 160,
    },
  },
  script: {
    title: "The 30-second grind test",
    angle: "Myth vs reality",
    script: {
      title: "The 30-second grind test",
      hook: "Your grinder isn't the problem. Your grind size is.",
      beats: [
        {
          time: "0–2s",
          visual: "Close-up: coffee dripping too fast",
          voiceover: "Your grinder isn't the problem.",
          onScreen: "Fast drip?",
        },
        {
          time: "2–12s",
          visual: "Hands pinching grounds between fingers",
          voiceover: "Pinch the grounds. Sand means finer. Sugar means coarser.",
          onScreen: "The pinch test",
        },
        {
          time: "12–24s",
          visual: "Side-by-side cups, one clearly richer",
          voiceover: "One notch changes the whole cup.",
          onScreen: "1 notch = new cup",
        },
        {
          time: "24–30s",
          visual: "Bag of beans, logo visible",
          voiceover: "Get our grind chart free — link in bio.",
          onScreen: "Free grind chart",
        },
      ],
      cta: "Get the free grind chart — link in bio.",
      caption: "The pinch test fixes more bad coffee than a new grinder. ☕️ #homebarista",
      durationSec: 30,
    },
  },
  image: {
    title: "Harvest morning in Huila",
    angle: "Origin story",
    variants: [
      {
        platform: "instagram",
        title: "Harvest",
        body: "5:40am in Huila. The cherries only get picked when they're this red. 🍒\n\nThis month's roast starts here → link in bio.\n\n#specialtycoffee #coffeefarm #huila",
        hashtags: [],
        chars: 150,
      },
      {
        platform: "tiktok",
        title: "Harvest",
        body: "POV: you only pick the red ones 🍒 #coffeetok #specialtycoffee",
        hashtags: [],
        chars: 60,
      },
    ],
    media: [ready(art(1080, 1920, "#223012", "#b5d84a", "Harvest morning"), "9:16")],
  },
  video: {
    title: "Roastery pan",
    angle: "Behind the scenes",
    variants: [
      {
        platform: "instagram",
        title: "Roastery",
        body: "Inside the roastery at 6am. Batch 214 is our darkest yet. ☕️ #roastery #specialtycoffee",
        hashtags: [],
        chars: 90,
      },
    ],
    media: [{ slot: "main", kind: "video", ratio: "9:16", status: "pending" }],
  },
  ad: {
    title: "Holiday gift subscription",
    angle: "Proof and results",
    ads: [
      {
        label: "Outcome",
        primaryText:
          "Give 3 months of freshly roasted coffee, delivered to their door. They'll think of you every morning.",
        headline: "The gift that shows up monthly",
        description: "Free shipping over $30",
        cta: "Shop now",
      },
      {
        label: "Pain",
        primaryText:
          "Still stuck on a gift? Skip the mall. A coffee subscription arrives in 2 days and lasts all season.",
        headline: "Gifting, solved in 2 minutes",
        description: "Delivered in 2 days",
        cta: "Get offer",
      },
      {
        label: "Proof",
        primaryText: "Rated 4.9 by 2,300 subscribers. Freshly roasted, shipped within 48 hours.",
        headline: "Coffee people actually rave about",
        description: "Cancel anytime",
        cta: "Learn more",
      },
    ],
    media: [ready(art(1080, 1350, "#1f2a12", "#8ab734", "Gift the good stuff"), "4:5")],
  },
};

const ROWS: Partial<Record<StudioType, ReviewRow[]>> = {
  social: [
    {
      id: "r1",
      status: "pending",
      title: "Sourcing",
      body: "",
      meta: { platform: "linkedin" },
      scheduled_at: null,
    },
    {
      id: "r2",
      status: "pending",
      title: "Sourcing",
      body: "",
      meta: { platform: "instagram" },
      scheduled_at: null,
    },
  ],
  carousel: [
    {
      id: "r3",
      status: "approved",
      title: "Cold brew",
      body: "",
      meta: { platform: "instagram" },
      scheduled_at: null,
    },
  ],
  article: [
    { id: "r4", status: "pending", title: "Decaf", body: "", meta: {}, scheduled_at: null },
  ],
  image: [
    {
      id: "r8",
      status: "pending",
      title: "Harvest",
      body: "",
      meta: { platform: "instagram" },
      scheduled_at: null,
    },
    {
      id: "r9",
      status: "pending",
      title: "Harvest",
      body: "",
      meta: { platform: "tiktok" },
      scheduled_at: null,
    },
  ],
  video: [
    {
      id: "r10",
      status: "pending",
      title: "Roastery",
      body: "",
      meta: { platform: "instagram" },
      scheduled_at: null,
    },
  ],
  script: [
    {
      id: "r5",
      status: "approved",
      title: "Grind",
      body: "",
      meta: { platform: "instagram" },
      scheduled_at: null,
    },
  ],
  ad: [
    {
      id: "r6",
      status: "pending",
      title: "Gift",
      body: "",
      meta: { platform: "facebook" },
      scheduled_at: null,
    },
    {
      id: "r7",
      status: "pending",
      title: "Gift",
      body: "",
      meta: { platform: "instagram" },
      scheduled_at: null,
    },
  ],
};

function session(
  type: StudioType,
  step: SessionStep,
  extra: Partial<StudioSession> = {},
): StudioSession {
  const output = OUTPUTS[type] ?? {};
  const job: StudioJob | null =
    step === "review" || step === "generating"
      ? ({
          ...BASE_JOB,
          id: `job-${type}`,
          type,
          title: output.title ?? null,
          input: {
            type,
            idempotencyKey: "lab",
            intent: { brief: "Lab brief" },
            controls: { platforms: [] },
          },
          output,
          content_item_ids: (ROWS[type] ?? []).map((r) => r.id),
          ...(step === "generating"
            ? { status: "running" as const, stage: "render" as const, output: {} }
            : {}),
        } as StudioJob)
      : null;
  return {
    id: `lab-${type}-${step}`,
    workspaceId: WS,
    type,
    step,
    brief:
      step === "intent" && !extra.brief
        ? ""
        : "Tell the story of how we source from the Huila co-op and why it makes the coffee better.",
    controls: {
      platforms:
        type === "article"
          ? []
          : type === "ad"
            ? ["facebook", "instagram"]
            : type === "script"
              ? ["instagram"]
              : ["linkedin", "instagram"],
      ratio: type === "ad" ? "4:5" : type === "carousel" ? "4:5" : "1:1",
      includeImage: type === "social",
      slideCount: 5,
      length: "standard",
      durationSec: type === "video" ? 6 : 30,
    },
    job,
    lastGood: step === "review" ? job : null,
    pendingKey: null,
    pendingKind: null,
    error: null,
    window: "open",
    createdAt: Date.now(),
    updatedAt: Date.now() - 12_000,
    ...extra,
  };
}

type Scene = {
  id: string;
  label: string;
  make?: () => StudioSession;
  fixtures?: { rows?: ReviewRow[]; distribution?: boolean };
  /** Simulate a full run: every stage in turn, then the finished review. */
  live?: StudioType;
  rail?: boolean;
  library?: boolean;
};

const approvedRows = (type: StudioType, status = "approved", scheduledAt: string | null = null) =>
  (ROWS[type] ?? []).map((r) => ({ ...r, status, scheduled_at: scheduledAt }));

const SCENES: Scene[] = [
  { id: "live-social", label: "Live run · Social", live: "social" },
  { id: "live-image", label: "Live run · Image", live: "image" },
  { id: "live-article", label: "Live run · Article", live: "article" },
  { id: "live-carousel", label: "Live run · Carousel", live: "carousel" },
  { id: "live-script", label: "Live run · Script", live: "script" },
  { id: "live-video", label: "Live run · Video", live: "video" },
  { id: "start", label: "Start", make: () => session("social", "start") },
  {
    id: "brief-social",
    label: "Brief · Social",
    make: () =>
      session("social", "intent", {
        brief: "Tell the story of our Huila co-op sourcing.",
        ideaId: "i3",
        goal: "awareness",
      }),
  },
  { id: "brief-article", label: "Brief · Article", make: () => session("article", "intent") },
  {
    id: "brief-template",
    label: "Brief · Template picked",
    make: () =>
      session("carousel", "intent", {
        brief: getTemplate("carousel-myth-fact")!.starter,
        template: "carousel-myth-fact",
        goal: "education",
      }),
  },
  {
    id: "brief-blueprint",
    label: "Brief · Blueprint, 3 platforms",
    make: () => {
      const s = session("social", "intent", {
        brief: "Tell the story of our Huila co-op sourcing.",
        template: "social-behind-scenes",
      });
      return {
        ...s,
        controls: {
          ...s.controls,
          platforms: ["linkedin", "instagram", "twitter"],
          includeImage: true,
          ratio: "4:5",
        },
      };
    },
  },
  {
    id: "brief-error",
    label: "Brief · Error",
    make: () =>
      session("video", "intent", {
        brief: "A slow pan across our roastery",
        error: "You've hit the video generation limit for now. Try again in a little while.",
      }),
  },
  {
    id: "gen-image",
    label: "Generating · Image render",
    make: () => session("image", "generating"),
  },
  {
    id: "gen-article",
    label: "Generating · Article writing",
    make: () => ({
      ...session("article", "generating"),
      job: { ...session("article", "generating").job!, stage: "writing" },
    }),
  },
  {
    id: "gen-social-context",
    label: "Generating · Social context",
    make: () => ({
      ...session("social", "generating", { goal: "awareness" }),
      job: { ...session("social", "generating").job!, stage: "context" },
    }),
  },
  {
    id: "review-social",
    label: "Review · Social",
    make: () => session("social", "review"),
    fixtures: { rows: ROWS.social, distribution: true },
  },
  {
    id: "review-image",
    label: "Review · Image 9:16",
    make: () => session("image", "review"),
    fixtures: { rows: ROWS.image, distribution: true },
  },
  {
    id: "review-video-rendering",
    label: "Review · Video rendering",
    make: () => session("video", "review"),
    fixtures: { rows: ROWS.video, distribution: true },
  },
  {
    id: "review-carousel",
    label: "Review · Carousel (approved)",
    make: () => session("carousel", "review"),
    fixtures: { rows: ROWS.carousel, distribution: true },
  },
  {
    id: "review-article",
    label: "Review · Article",
    make: () => session("article", "review"),
    fixtures: { rows: ROWS.article },
  },
  {
    id: "review-script",
    label: "Review · Script",
    make: () => session("script", "review"),
    fixtures: { rows: ROWS.script },
  },
  {
    id: "review-ad",
    label: "Review · Ad",
    make: () => session("ad", "review"),
    fixtures: { rows: ROWS.ad },
  },
  {
    id: "review-revising",
    label: "Review · Revising",
    make: () => {
      const base = session("social", "review");
      return {
        ...base,
        pendingKind: "refine" as const,
        job: {
          ...base.job!,
          id: "job-refine",
          status: "running" as const,
          stage: "writing" as const,
        },
      };
    },
    fixtures: { rows: ROWS.social, distribution: true },
  },
  {
    id: "review-approved",
    label: "Review · Approved, ready to ship",
    make: () => session("social", "review"),
    fixtures: { rows: approvedRows("social"), distribution: true },
  },
  {
    id: "review-scheduled",
    label: "Review · Scheduled",
    make: () => session("social", "review"),
    fixtures: {
      rows: approvedRows("social", "scheduled", new Date(Date.now() + 86_400_000).toISOString()),
      distribution: true,
    },
  },
  {
    id: "review-partial",
    label: "Review · Partial",
    make: () => ({
      ...session("social", "review"),
      lastGood: {
        ...session("social", "review").lastGood!,
        output: {
          ...OUTPUTS.social!,
          media: [
            {
              slot: "main",
              kind: "image",
              ratio: "1:1",
              status: "failed",
              error: "The provider couldn't finish this render.",
            },
          ],
          partial: [{ target: "media", error: "The provider couldn't finish this render." }],
        },
      },
    }),
    fixtures: { rows: ROWS.social, distribution: true },
  },
  { id: "rail", label: "Rail · Queue, progress, dock", rail: true },
  { id: "library", label: "Library · Posts and media", library: true },
];

/** What a real job has saved by each stage, so the feed and live preview can be seen. */
function progressiveOutput(type: StudioType, stageIndex: number): StudioJobOutput {
  const full = OUTPUTS[type] ?? {};
  const ids = STUDIO_FORMATS[type].stages.map((s) => s.id);
  const out: StudioJobOutput = {};
  if (stageIndex >= 1) out.angle = full.angle;
  const writeAt = Math.max(ids.indexOf("writing"), ids.indexOf("captions"));
  if (writeAt >= 0 && stageIndex > writeAt) {
    Object.assign(out, {
      title: full.title,
      variants: full.variants,
      slides: full.slides,
      article: full.article,
      script: full.script,
      ads: full.ads,
    });
  }
  const renderAt = ids.indexOf("render");
  if (renderAt >= 0 && stageIndex >= renderAt) {
    out.concept =
      "Early light over ripe red coffee cherries on the branch, shallow depth of field, deep brand greens.";
  }
  return out;
}

function LiveComposer({ type, isMobile }: { type: StudioType; isMobile: boolean }) {
  const stages = STUDIO_FORMATS[type].stages;
  const [s, setS] = useState<StudioSession>(() => {
    const base = session(type, "generating", {
      goal: "awareness",
      template: templatesFor(type)[0]?.id,
    });
    return {
      ...base,
      job: { ...base.job!, stage: stages[0].id, created_at: new Date().toISOString() },
    };
  });

  useEffect(() => {
    const started = Date.now();
    let i = 0;
    const t = window.setInterval(() => {
      i += 1;
      if (i < stages.length) {
        setS((prev) => ({
          ...prev,
          job: { ...prev.job!, stage: stages[i].id, output: progressiveOutput(type, i) },
        }));
        return;
      }
      window.clearInterval(t);
      const done = session(type, "review", { template: templatesFor(type)[0]?.id });
      const finished = {
        ...done.job!,
        created_at: new Date(started).toISOString(),
        completed_at: new Date().toISOString(),
      };
      setS({ ...done, job: finished, lastGood: finished });
    }, 3200);
    return () => window.clearInterval(t);
  }, [type, stages]);

  return (
    <ComposerBody
      session={s}
      isMobile={isMobile}
      fixtures={{ ideas: IDEAS, rows: ROWS[type], distribution: true }}
    />
  );
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/** Raw rows as the database returns them, so the lab exercises the real grouping. */
const RAIL_ROWS: ContentRow[] = [
  {
    id: "x1",
    title: "Harvest",
    body: "5:40am in Huila. The cherries only get picked when they're this red. 🍒\n\n#specialtycoffee #huila",
    kind: "image",
    channel: "instagram",
    status: "pending",
    meta: {
      source: "studio",
      studio_type: "image",
      group_id: "g-image",
      job_id: "job-image",
      job_title: "Harvest morning in Huila",
      platform: "instagram",
      asset_storage_path: "thumb-1",
      media_type: "image",
    },
    created_at: minutesAgo(4),
    updated_at: minutesAgo(4),
    scheduled_at: null,
  },
  {
    id: "x1b",
    title: "Harvest",
    body: "POV: you only pick the red ones 🍒 #coffeetok",
    kind: "image",
    channel: "tiktok",
    status: "pending",
    meta: {
      source: "studio",
      studio_type: "image",
      group_id: "g-image",
      job_id: "job-image",
      job_title: "Harvest morning in Huila",
      platform: "tiktok",
      asset_storage_path: "thumb-1",
      media_type: "image",
    },
    created_at: minutesAgo(4),
    updated_at: minutesAgo(4),
    scheduled_at: null,
  },
  {
    id: "x2",
    title: null,
    body: "Cold brew tips for summer: steep 18 hours, then dilute 1:1. Save this for your next batch.",
    kind: "post",
    channel: "linkedin",
    status: "pending",
    meta: { source: "chat" },
    created_at: minutesAgo(30),
    updated_at: minutesAgo(30),
    scheduled_at: null,
  },
  {
    id: "x3",
    title: "Pay the farmer, taste the difference",
    body: "We pay the Huila co-op 30% above fair-trade minimums. Not as charity, as quality control.",
    kind: "post",
    channel: "linkedin",
    status: "failed",
    meta: {
      source: "studio",
      studio_type: "social",
      group_id: "g-social",
      job_id: "job-social",
      platform: "linkedin",
    },
    created_at: minutesAgo(90),
    updated_at: minutesAgo(20),
    scheduled_at: null,
  },
  {
    id: "x4",
    title: "Decaf that doesn't taste like decaf: a buyer's guide",
    body: "How modern decaffeination works, and the three things to check before you buy.",
    kind: "blog",
    channel: null,
    status: "approved",
    meta: {
      source: "studio",
      studio_type: "article",
      group_id: "g-article",
      job_id: "job-article",
    },
    created_at: minutesAgo(180),
    updated_at: minutesAgo(60),
    scheduled_at: null,
  },
  {
    id: "x5",
    title: "Is your cold brew under-extracted?",
    body: "Sour cold brew? Swipe for the 5 signs and how to fix each.",
    kind: "carousel",
    channel: "instagram",
    status: "scheduled",
    meta: {
      source: "studio",
      studio_type: "carousel",
      group_id: "g-carousel",
      job_id: "job-carousel",
      platform: "instagram",
    },
    created_at: minutesAgo(300),
    updated_at: minutesAgo(40),
    scheduled_at: new Date(Date.now() + 20 * 3_600_000).toISOString(),
  },
  {
    // An empty calendar placeholder: must not appear anywhere.
    id: "x6",
    title: "Untitled post",
    body: null,
    kind: "post",
    channel: "instagram",
    status: "draft",
    meta: { source: "calendar" },
    created_at: minutesAgo(10),
    updated_at: minutesAgo(10),
    scheduled_at: null,
  },
];

const RAIL_GROUPS = groupRows(RAIL_ROWS);

function RailScene() {
  const carousel = session("carousel", "generating");
  const running: StudioSession = {
    ...carousel,
    job: { ...carousel.job!, stage: "writing", title: "Is your cold brew under-extracted?" },
  };
  const video = session("video", "generating");
  const failed: StudioJob = {
    ...video.job!,
    id: "job-failed",
    group_id: "g-failed",
    status: "failed",
    title: "Roastery pan",
    error: { category: "provider", message: "The video provider timed out.", retryable: true },
  };
  const docked: StudioSession[] = [
    running,
    session("social", "review"),
    { ...video, id: "lab-video-docked", job: { ...video.job!, stage: "render" } },
  ];
  return (
    <div className="flex flex-wrap items-start justify-center gap-10">
      <div className="w-[340px] space-y-6 rounded-2xl bg-surface-1 p-3.5 ring-1 ring-border">
        <PipelineSection
          groups={RAIL_GROUPS}
          loading={false}
          error={null}
          thumbs={{ "thumb-1": art(1280, 720, "#223012", "#b5d84a", "Harvest") }}
          jobs={[running.job!, failed]}
          agentActions={2}
          publishedThisWeek={4}
          onRefresh={() => {}}
          fixture
        />
      </div>
      <div className="flex w-[340px] flex-col items-end gap-2">
        {docked.map((d) => (
          <DockCard key={d.id} session={d} />
        ))}
      </div>
    </div>
  );
}

function libraryFixtures() {
  return {
    fixtureGroups: RAIL_GROUPS,
    fixtureThumbs: { "thumb-1": art(1280, 960, "#223012", "#b5d84a", "Harvest") },
    fixtureAssets: [
      normalizeLibraryAsset({
        id: "asset-1",
        title: "Harvest morning",
        media_url: art(1080, 1350, "#1f2a12", "#8ab734", "Gift the good stuff"),
        kind: "image",
        created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
        source: "generated",
      }),
    ],
  };
}

type Device = "phone" | "tablet" | "window" | "wide";

/** Frame sizes that match how the composer window really appears. */
const FRAME: Record<Device, string> = {
  phone: "h-[844px] w-[390px] rounded-[28px]",
  tablet: "h-[900px] w-[820px] rounded-2xl",
  window: "h-[860px] w-[1240px] rounded-2xl",
  wide: "h-[960px] w-[1680px] rounded-2xl",
};

export function StudioLab() {
  const [scene, setScene] = useState(SCENES[0].id);
  const [device, setDevice] = useState<Device>("window");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const s = url.searchParams.get("scene");
    if (s && SCENES.some((x) => x.id === s)) setScene(s);
    const d = url.searchParams.get("device");
    if (d === "mobile" || d === "phone") setDevice("phone");
    else if (d === "tablet" || d === "wide") setDevice(d);
    if (url.searchParams.get("theme") === "dark") setDark(true);
  }, []);

  // The app's ThemeProvider owns the <html> class; go through it so it doesn't
  // overwrite the lab's choice.
  const { setPreference } = useTheme();
  useEffect(() => {
    setPreference(dark ? "dark" : "light");
  }, [dark, setPreference]);

  const current = SCENES.find((s) => s.id === scene) ?? SCENES[0];
  const sessionData = useMemo(() => current.make?.() ?? null, [current]);
  const [runKey, setRunKey] = useState(0);

  return (
    <div className="min-h-dvh bg-surface-1 text-foreground">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-surface-3 px-4 py-2">
        <strong className="mr-2 text-sm">Studio lab</strong>
        <select
          value={scene}
          onChange={(e) => setScene(e.target.value)}
          className="h-8 rounded-md border border-input bg-surface-3 px-2 text-sm"
        >
          {SCENES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={device}
          onChange={(e) => setDevice(e.target.value as Device)}
          aria-label="Window size"
          className="h-8 rounded-md border border-input bg-surface-3 px-2 text-sm"
        >
          <option value="phone">Phone · 390</option>
          <option value="tablet">Tablet · 820</option>
          <option value="window">Window · 1240</option>
          <option value="wide">Maximized · 1680</option>
        </select>
        <button
          type="button"
          onClick={() => setDark((d) => !d)}
          className="h-8 rounded-md border border-input px-3 text-sm"
        >
          {dark ? "Dark" : "Light"}
        </button>
        {current.live ? (
          <button
            type="button"
            onClick={() => setRunKey((k) => k + 1)}
            className="h-8 rounded-md border border-input px-3 text-sm"
          >
            Replay
          </button>
        ) : null}
        <span className="text-xs text-muted-foreground">Sample data · dev only</span>
      </div>
      {current.library ? (
        <div className="p-6">
          <div className="mx-auto mb-4 flex max-w-[1240px] justify-end">
            <button
              type="button"
              onClick={() => emitAppEvent("open:library")}
              className="h-8 rounded-md border border-input px-3 text-sm"
            >
              Open as pop-up
            </button>
            <LibraryDialog {...libraryFixtures()} />
          </div>
          <div className="mx-auto h-[860px] max-w-[1240px] overflow-hidden rounded-2xl border border-border shadow-4">
            <LibraryPage {...libraryFixtures()} />
          </div>
        </div>
      ) : current.rail ? (
        <div className="p-6">
          <RailScene />
        </div>
      ) : (
        <div className="flex justify-center overflow-x-auto p-6">
          <div
            key={`${scene}-${device}-${runKey}`}
            className={cn(
              "flex flex-col overflow-hidden border border-border bg-surface-3 shadow-4",
              FRAME[device],
            )}
          >
            <DialogPrimitive.Root open modal={false}>
              {current.live ? (
                <LiveComposer type={current.live} isMobile={device === "phone"} />
              ) : sessionData ? (
                <ComposerBody
                  session={sessionData}
                  isMobile={device === "phone"}
                  fixtures={{ ideas: IDEAS, ...current.fixtures }}
                />
              ) : null}
            </DialogPrimitive.Root>
          </div>
        </div>
      )}
    </div>
  );
}
